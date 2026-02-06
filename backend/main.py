import argparse
import json
import os
import pickle
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict
from typing import Optional

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn
import minsearch


# --- Data Models ---

@dataclass
class Conversation:
    id: str
    title: str
    create_time: float
    update_time: float
    model: Optional[str]
    mapping: dict
    is_archived: bool = False


class StatsResponse(BaseModel):
    totalConversations: int
    totalMessages: int
    dateRange: dict[str, str]
    topModels: list[dict[str, int | str]]


class ContributionResponse(BaseModel):
    year: int
    days: list[dict]  # list of {date, count}
    max: int
    total: int


class ConversationsListResponse(BaseModel):
    date: str
    conversations: list[dict]


class ConversationDetailResponse(BaseModel):
    id: str
    title: str
    createTime: str
    updateTime: str
    model: Optional[str]
    messages: list[dict]
    isArchived: bool


class SearchResponse(BaseModel):
    query: str
    results: list[dict]


# --- Service ---

class ConversationService:
    def __init__(self, data_path: str):
        self.conversations: list[Conversation] = []
        self.by_date: dict[str, list[Conversation]] = defaultdict(list)
        self.by_id: dict[str, Conversation] = {}
        self.search_index: Optional[minsearch.Index] = None
        self._load_data(data_path)
        self._load_or_create_index(data_path)

    def _load_data(self, data_path: str):
        print(f"Loading conversations from {data_path}...")
        with open(data_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        for conv in data:
            create_time = conv.get("create_time")
            if create_time is None:
                continue

            c = Conversation(
                id=conv.get("id", conv.get("conversation_id", "")),
                title=conv.get("title", ""),
                create_time=create_time,
                update_time=conv.get("update_time", create_time),
                model=conv.get("default_model_slug"),
                mapping=conv.get("mapping", {}),
                is_archived=conv.get("is_archived", False),
            )
            self.conversations.append(c)
            self.by_id[c.id] = c

            dt = datetime.fromtimestamp(create_time, tz=timezone.utc)
            date_key = dt.strftime("%Y-%m-%d")
            self.by_date[date_key].append(c)

        print(f"Loaded {len(self.conversations)} conversations")

    def get_stats(self) -> StatsResponse:
        if not self.conversations:
            return StatsResponse(
                totalConversations=0,
                totalMessages=0,
                dateRange={"start": "", "end": ""},
                topModels=[],
            )

        timestamps = [c.create_time for c in self.conversations]
        model_counts: dict[str, int] = defaultdict(int)
        total_messages = 0

        for c in self.conversations:
            if c.model:
                model_counts[c.model] += 1
            total_messages += sum(
                1 for node in c.mapping.values() if node.get("message")
            )

        start_dt = datetime.fromtimestamp(min(timestamps), tz=timezone.utc)
        end_dt = datetime.fromtimestamp(max(timestamps), tz=timezone.utc)

        top_models = [
            {"model": m, "count": c}
            for m, c in sorted(model_counts.items(), key=lambda x: -x[1])
        ][:10]

        return StatsResponse(
            totalConversations=len(self.conversations),
            totalMessages=total_messages,
            dateRange={
                "start": start_dt.strftime("%Y-%m-%d"),
                "end": end_dt.strftime("%Y-%m-%d"),
            },
            topModels=top_models,
        )

    def get_contribution(self, year: int) -> ContributionResponse:
        import calendar
        from datetime import timedelta

        # Get all dates in the year
        all_days = {}
        for month in range(1, 13):
            _, days_in_month = calendar.monthrange(year, month)
            for day in range(1, days_in_month + 1):
                date_key = f"{year}-{month:02d}-{day:02d}"
                all_days[date_key] = 0

        # Fill in actual counts
        for date_key, convs in self.by_date.items():
            dt = datetime.fromisoformat(date_key)
            if dt.year == year:
                all_days[date_key] = len(convs)

        # Convert to list of dicts
        days = [{"date": k, "count": v} for k, v in all_days.items()]
        days.sort(key=lambda x: x["date"])

        max_count = max(all_days.values()) if all_days else 0
        total = sum(all_days.values())

        return ContributionResponse(year=year, days=days, max=max_count, total=total)

    def get_conversations_by_date(self, date: str) -> ConversationsListResponse:
        convs = self.by_date.get(date, [])
        convs_sorted = sorted(convs, key=lambda c: -c.create_time)

        conversations = [
            {
                "id": c.id,
                "title": c.title or "(no title)",
                "createTime": datetime.fromtimestamp(
                    c.create_time, tz=timezone.utc
                ).isoformat(),
                "model": c.model,
                "messageCount": sum(1 for n in c.mapping.values() if n.get("message")),
            }
            for c in convs_sorted
        ]

        return ConversationsListResponse(date=date, conversations=conversations)

    def get_conversation(self, conv_id: str) -> Optional[ConversationDetailResponse]:
        c = self.by_id.get(conv_id)
        if not c:
            return None

        messages = self._linearize_messages(c.mapping)

        return ConversationDetailResponse(
            id=c.id,
            title=c.title or "(no title)",
            createTime=datetime.fromtimestamp(c.create_time, tz=timezone.utc).isoformat(),
            updateTime=datetime.fromtimestamp(c.update_time, tz=timezone.utc).isoformat(),
            model=c.model,
            messages=messages,
            isArchived=c.is_archived,
        )

    def _linearize_messages(self, mapping: dict) -> list[dict]:
        messages = []

        for node_id, node in mapping.items():
            msg = node.get("message")
            if not msg:
                continue

            author = msg.get("author", {})
            content = msg.get("content", {})
            parts = content.get("parts", [])

            # Extract content as string, handling various content types
            content_text = ""
            if parts:
                for part in parts:
                    if isinstance(part, str):
                        content_text += part
                    elif isinstance(part, dict):
                        # Handle content objects (code, images, etc.)
                        if "text" in part:
                            content_text += part["text"]
                        elif "content" in part:
                            content_text += str(part["content"])

            create_time = msg.get("create_time")
            # Handle invalid timestamps on Windows
            timestamp = None
            if create_time and create_time > 0:
                try:
                    timestamp = datetime.fromtimestamp(create_time, tz=timezone.utc).isoformat()
                except (OSError, OverflowError, ValueError):
                    pass

            messages.append(
                {
                    "id": msg.get("id"),
                    "role": author.get("role"),
                    "name": author.get("name"),
                    "content": content_text,
                    "createTime": create_time,
                    "timestamp": timestamp,
                }
            )

        messages.sort(key=lambda m: m["createTime"] or 0)
        return messages

    def _get_index_path(self, data_path: str) -> str:
        return data_path + ".index"

    def _load_or_create_index(self, data_path: str):
        index_path = self._get_index_path(data_path)

        # Try to load existing index
        if os.path.exists(index_path):
            try:
                with open(index_path, "rb") as f:
                    self.search_index = pickle.load(f)
                print(f"Loaded search index from {index_path}")
                return
            except Exception as e:
                print(f"Failed to load index: {e}, creating new one...")

        # Create new index
        print("Building search index...")
        self.search_index = minsearch.Index(
            text_fields=["title", "content"],
            keyword_fields=["id", "createTime", "model"]
        )

        # Prepare documents for indexing
        documents = []
        for c in self.conversations:
            # Extract all message content
            messages = self._linearize_messages(c.mapping)
            content_parts = []
            for m in messages:
                if m.get("content"):
                    content_parts.append(str(m["content"]))

            content = " ".join(content_parts)

            documents.append({
                "id": c.id,
                "title": c.title or "",
                "content": content,
                "createTime": datetime.fromtimestamp(c.create_time, tz=timezone.utc).isoformat(),
                "model": c.model or "",
            })

        self.search_index.fit(documents)
        self._save_index(data_path)
        print(f"Search index built with {len(documents)} documents")

    def _save_index(self, data_path: str):
        index_path = self._get_index_path(data_path)
        with open(index_path, "wb") as f:
            pickle.dump(self.search_index, f)
        print(f"Saved search index to {index_path}")

    def search(self, query: str, limit: int = 20) -> list[dict]:
        if not self.search_index:
            return []

        # Boost title matches higher
        boost = {"title": 3.0, "content": 1.0}
        results = self.search_index.search(query, boost_dict=boost, num_results=limit)

        return results


# --- FastAPI App ---

service: ConversationService


def create_app(data_path: str) -> FastAPI:
    global service
    service = ConversationService(data_path)

    app = FastAPI(title="ChatGPT Data Viewer API")

    @app.get("/api/stats")
    def get_stats() -> StatsResponse:
        return service.get_stats()

    @app.get("/api/contribution")
    def get_contribution(year: int = 2025) -> ContributionResponse:
        return service.get_contribution(year)

    @app.get("/api/conversations")
    def get_conversations(date: str) -> ConversationsListResponse:
        return service.get_conversations_by_date(date)

    @app.get("/api/conversation/{conv_id}")
    def get_conversation(conv_id: str) -> ConversationDetailResponse | dict:
        result = service.get_conversation(conv_id)
        if not result:
            return {"error": "not found"}
        return result

    @app.get("/api/search")
    def search(q: str, limit: int = 20) -> SearchResponse:
        results = service.search(q, limit)
        return SearchResponse(query=q, results=results)

    # Serve frontend static files
    frontend_path = Path(__file__).parent.parent / "frontend" / "dist"
    if frontend_path.exists():
        app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")

    return app


# Create app instance for uvicorn
data_path = os.environ.get("CONVERSATIONS_DATA_PATH", "../data/conversations.json")
app = create_app(data_path)
