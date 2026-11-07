# LedgerLens

LedgerLens is a local-first invoice and document processing workspace. Upload PDFs, images, and spreadsheets; extract text with OCR; identify invoice fields with Gemini; review and correct results; and search documents by keyword or meaning.

The default setup uses MongoDB 7 and Redis 7 in Docker. The API, queue worker, document processor, and web app can run in Docker or locally during development. Local semantic search uses Gemini embeddings stored in MongoDB and cosine similarity; MongoDB Atlas is not required.

## Features

- Upload PDFs, JPEG/PNG/TIFF images, and XLS/XLSX/CSV spreadsheets.
- Preview the original file and extracted text or spreadsheet tables.
- Track processing progress, including OCR pages and spreadsheet sheets.
- Extract invoice fields with Gemini primary and fallback models.
- Review and correct extracted fields; validated documents move to **Completed**.
- Search by keyword or semantic meaning, with similarity scores and pagination.
- Persist OCR text, tables, and embeddings so retries and searches can reuse them.

## Requirements

### Docker setup (recommended)

- Docker Desktop with Docker Compose v2.
- A Google Gemini API key for AI extraction and semantic search.

### Run application services locally

- Node.js 22 or newer and npm.
- Python 3.12 and pip.
- Tesseract OCR installed and available on `PATH`.
- Docker Desktop for the MongoDB and Redis services.
- A Google Gemini API key for AI extraction and semantic search.

## Quick start with Docker

1. Clone the repository and open its directory:

   ```powershell
   git clone https://github.com/<your-account>/<your-repository>.git
   cd <your-repository>
   ```

2. Create your local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Open `.env` and set `GEMINI_API_KEY` to your own key. Keep it private; do not commit `.env` or put the key in frontend code.

4. Build and start the application:

   ```powershell
   docker compose up --build -d
   ```

5. Open [http://localhost:8080](http://localhost:8080). Check service status with:

   ```powershell
   docker compose ps
   ```

View logs with `docker compose logs -f api queue-worker processor frontend`. Stop the services with `docker compose down`. MongoDB and Redis data are stored in Docker volumes; `docker compose down` keeps those volumes.

The Compose setup exposes the web app at port `8080`, MongoDB at `27018`, and Redis at `6381`, all bound to localhost. The processor and API are internal services. Uploaded originals are stored in `backend/uploads`, shared by the API and worker.

## Local development

Use the local workflow when you want hot reload for the API, worker, processor, or frontend. Keep each service running in its own terminal.

1. Clone the repository, create `.env` from `.env.example`, and set `GEMINI_API_KEY` as described above.

2. Start the local MongoDB and Redis containers:

   ```powershell
   docker compose up -d mongo redis
   ```

3. From the repository root, install the Node.js dependencies:

   ```powershell
   npm install
   ```

4. Create a Python environment and install the document processor dependencies:

   ```powershell
   cd python-worker
   py -3.12 -m venv .venv
   .venv\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   ```

   If PowerShell blocks environment activation, either allow activation for your user according to the [Microsoft PowerShell guidance](https://learn.microsoft.com/powershell/module/microsoft.powershell.security/set-executionpolicy), or activate from Command Prompt with `.venv\Scripts\activate.bat`.

5. Install Tesseract OCR for your operating system and verify `tesseract --version` works in a new terminal. On Windows, use the [UB Mannheim Tesseract installer](https://github.com/UB-Mannheim/tesseract/wiki) and add its installation directory to `PATH` if the installer did not do so.

6. Start the Python document processor from `python-worker`:

   ```powershell
   uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
   ```

7. Open three more terminals at the repository root and start the API, queue worker, and frontend:

   ```powershell
   npm run dev:api
   ```

   ```powershell
   npm run dev:worker
   ```

   ```powershell
   npm run dev:web
   ```

8. Open [http://localhost:5173](http://localhost:5173).

The Vite development server proxies `/api` and `/health` to the local API at `http://localhost:4000`. Keep the API, worker, processor, MongoDB, and Redis running while using the app. Running `npm run dev:web` alone is not sufficient to upload, preview, or search documents.

On macOS or Linux, create and activate the Python environment with:

```bash
cd python-worker
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Then follow the same service startup commands from the appropriate directories.

## Configuration

`.env.example` contains the configuration template. Copy it to `.env` for local development; Docker Compose also loads this file. The API key is used only by the backend and worker.

| Variable | Purpose | Example/default |
| --- | --- | --- |
| `GEMINI_API_KEY` | Google Gemini API key. Required for AI extraction and semantic search. | Empty in template |
| `GEMINI_MODEL` | Primary invoice extraction model. | `gemini-3.8-flash` |
| `GEMINI_FALLBACK_MODEL` | Model tried after temporary primary-model failures. | `gemini-3.5-flash-lite` |
| `GEMINI_EMBEDDING_MODEL` | Model used to embed documents and search queries. | `gemini-embedding-001` |
| `GEMINI_EMBEDDING_DIMENSIONS` | Expected vector size for stored embeddings. | `768` |
| `MONGODB_URI` | MongoDB connection string for local, host-run services. | `mongodb://localhost:27018/document_intelligence` |
| `REDIS_URL` | Redis connection string for local, host-run services. | `redis://localhost:6381` |
| `PROCESSOR_URL` | URL used by the API/worker to reach the Python processor. | `http://localhost:8000` |
| `PROCESSING_API_URL` | API callback base URL used by the Python processor for progress updates. Usually set in the process environment. | `http://localhost:4000/api` |
| `UPLOAD_DIR` | Directory for uploaded originals, relative to the backend working directory unless absolute. | `./uploads` |
| `FRONTEND_ORIGIN` | Allowed browser origin for the API. | `http://localhost:5173` |
| `PORT` | Local API port. | `4000` |
| `MAX_UPLOAD_BYTES` | Maximum file size in bytes. | `26214400` (25 MiB) |
| `MAX_FILES_PER_UPLOAD` | Maximum number of files per upload request. | `10` |

Compose overrides the MongoDB, Redis, processor, upload-directory, and frontend-origin settings for its internal Docker network. Do not put secrets in `VITE_*` variables: frontend settings are public in the built JavaScript.

## Document workflow

1. Upload one or more supported files from **Overview**.
2. Follow the **Processing** page for live queue and OCR progress.
3. Open a document in **Reviews** to inspect its original file and extracted invoice fields.
4. Save corrections. If validation passes, the document moves to **Completed**; if issues remain, it stays in **Reviews** with the validation messages.
5. Search from **Search documents** using **Semantic** or **Keywords** mode.

Semantic search embeds the query with Gemini, loads document vectors from the local MongoDB collection, and ranks them with cosine similarity in the Node.js API. It returns similarity scores, page information, and a count of documents missing valid embeddings. Document embeddings are generated during processing and reused on later searches and retries. Existing documents without embeddings need to be reprocessed to become available to semantic search. This in-memory ranking is intended for small-to-medium local workspaces; large collections should use a database with native vector indexing.

Invoice extraction tries `gemini-3.8-flash` and falls back to `gemini-3.5-flash-lite` on temporary HTTP 429, 500, 502, 503, and 504 responses. Each model gets retries with exponential backoff; BullMQ retries the job if transient failures persist. OCR text and tables are saved before AI extraction so retries do not need to OCR the file again.

## API endpoints

The API is available at `http://localhost:4000` in local development and through `http://localhost:8080/api` when using Docker.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | API health check |
| `POST` | `/api/documents/upload` | Upload multipart field `files` (up to 10 files, 25 MiB each) |
| `GET` | `/api/documents/status/:jobId` | Check queue and processing progress |
| `GET` | `/api/documents/results?page=1&limit=20&status=requires_review` | List documents |
| `GET` | `/api/documents/search?q=...&mode=keyword\|semantic&page=1&limit=20` | Search documents; semantic results include cosine `score` |
| `GET` | `/api/documents/:documentId` | Get a document and its review data |
| `GET` | `/api/documents/:documentId/file` | View/download the original document |
| `PUT` | `/api/documents/corrections/:documentId` | Save corrected extraction fields |
| `POST` | `/api/documents/reprocess/:documentId` | Retry a failed document |

Correction requests use a JSON body shaped like `{ "extraction": { "invoiceNumber": "INV-123" } }`. Validation runs again when corrections are saved.

## Tests and builds

Run from the repository root:

```powershell
npm test
npm run build
```

The backend tests include Gemini failover and local cosine ranking/pagination. The frontend test command succeeds when no frontend test files are present.

Run the Python processor tests from `python-worker` after installing its requirements:

```powershell
python -m unittest discover -s tests
```

## Troubleshooting

- **`localhost refused to connect`**: With Docker, open port `8080` and check `docker compose ps`. For local development, open port `5173` and ensure API, worker, processor, MongoDB, and Redis are running.
- **Blank preview or missing original file**: Use the app origin for the preview (`8080` with Docker or `5173` locally). Verify the API and worker share the same upload directory; the Compose configuration mounts `backend/uploads` into both.
- **Upload fails or stays queued**: Check `docker compose logs -f api queue-worker processor`, and confirm MongoDB and Redis are healthy. For local services, verify `.env` uses the mapped ports `27018` and `6381`.
- **OCR cannot find Tesseract**: Install Tesseract and ensure `tesseract --version` works in the terminal running the processor.
- **Gemini errors or quota limits**: Verify `GEMINI_API_KEY` and the model availability for your account. Transient extraction errors trigger model fallback and queue retries; OCR content remains available for review. Semantic search returns an explicit error if it cannot create the query embedding.
- **Documents missing from semantic results**: Semantic search reports documents without valid embeddings. Reprocess the document to generate one; searches reuse vectors already stored in MongoDB.

## Uploading this project to GitHub

The `.gitignore` excludes `.env`, dependency folders, build output, Python caches/environments, and `uploads/`. Before pushing, check that no credentials, private documents, generated data, or other sensitive files are staged.

From the project directory, create an empty repository on GitHub, then initialize and push the source:

```powershell
git init
git add .
git status --short
```

Review the staged file list. It should not include `.env`, files under `backend/uploads/`, `node_modules/`, Python virtual environments, or real customer documents. If any secret or private data is staged, unstage it and fix the ignore rules before continuing. Then commit and push (replace the URL with your repository):

```powershell
git commit -m "Prepare LedgerLens for GitHub"
git branch -M main
git remote add origin https://github.com/<your-account>/<your-repository>.git
git push -u origin main
```

If Git is already initialized, do not run `git init` again; inspect `git status` and use the existing remote. If an API key was ever committed or shared, revoke it in Google AI Studio and create a replacement—removing the file in a later commit does not erase it from Git history.

## Security and production notes

- Never commit `.env`, API keys, real invoices, database dumps, or uploaded source documents. Use `.env.example` for placeholders.
- Invoice data and OCR text can contain sensitive financial information. Set appropriate retention, encryption, access controls, and audit logging.
- This starter application is single-tenant and has no built-in authentication. Do not expose it publicly without adding authentication/authorization, tenant isolation, TLS, and production-grade secrets and storage management.
- The processor service is intended to remain private to the application network. Do not expose it directly to the internet.
- The default Compose MongoDB and Redis ports bind to localhost. Adjust network exposure deliberately if deploying beyond a local workstation.
