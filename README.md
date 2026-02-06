# ChatGPT Data Viewer

Browse your ChatGPT conversation history with a GitHub-style contribution graph and full-text search.

## Features

- GitHub-style activity graph - Visual overview of your conversation activity
- Year and rolling 12-month views - Switch between different time ranges
- Full-text search - Search through all your conversations with minsearch
- Conversation details - View complete message history for any conversation
- Export to Markdown - Download conversations as `.md` files
- Dark theme - GitHub-inspired dark UI

## Setup

1. Export your ChatGPT data
   - Go to [ChatGPT](https://chat.openai.com) → Settings → Data Controls → Export
   - Extract the downloaded file and find `conversations.json`

2. Place conversations.json in the data folder
   ```bash
   cp /path/to/conversations.json data/
   ```

3. Install backend dependencies
   ```bash
   cd backend
   uv sync
   ```

4. Build the frontend
   ```bash
   cd frontend
   npm install
   npm run build
   cd ..
   ```

5. Run the server
   ```bash
   cd backend
   make dev
   ```

6. Open in browser
   ```
   http://127.0.0.1:8080
   ```

## Usage

- Activity graph: Click on any cell to see conversations for that day
- Year selector: Switch between "Last 12 months" or specific years
- Search: Enter keywords to search across all conversation titles and content
- Export: Click "Download as Markdown" to save a conversation

## API Endpoints

- `GET /api/stats` - Overview statistics
- `GET /api/contribution?year=2025` - Contribution data for a year
- `GET /api/conversations?date=2025-01-15` - Conversations for a specific date
- `GET /api/conversation/{id}` - Full conversation with messages
- `GET /api/search?q=query&limit=20` - Search conversations

## Development

### Backend (FastAPI + Python)
```bash
cd backend
uv sync                    # Install dependencies
make dev                   # Run with auto-reload on port 8080
```

### Frontend (Vite + vanilla JS)
```bash
cd frontend
npm install                # Install dependencies
npm run build              # Build for production
npm run dev                # Dev server with hot reload
```

## Project Structure

```
.
├── backend/
│   ├── main.py            # FastAPI app + search index
│   ├── pyproject.toml     # Python dependencies
│   └── Makefile           # Dev commands
├── frontend/
│   ├── src/
│   │   ├── app.js         # Main application
│   │   └── style.css      # GitHub-dark theme
│   ├── package.json       # Node dependencies
│   └── dist/              # Built frontend (served by backend)
├── data/
│   └── conversations.json # Your ChatGPT export (not in git)
└── README.md
```

## Tech Stack

- Backend: FastAPI, uvicorn, minsearch, Python 3.13
- Frontend: Vite, vanilla JS, CSS Grid
- Search: minsearch (TF-IDF based full-text search)
