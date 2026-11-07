import { useState, type FormEvent } from "react";
import { format } from "date-fns";
import { ArrowUpRight, LoaderCircle, Search, Sparkles } from "lucide-react";
import { api, errorMessage } from "../api";
import type { DocumentRecord } from "../types";

type Props = { onSelect: (id: string) => void };
type SearchDocument = DocumentRecord & { score?: number };
type SearchResponse = {
  documents: SearchDocument[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  mode: string;
  unindexedDocuments?: number;
};

export default function SearchPanel({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"keyword" | "semantic">("semantic");
  const [documents, setDocuments] = useState<SearchDocument[]>([]);
  const [resultMode, setResultMode] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [unindexedDocuments, setUnindexedDocuments] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  const search = async (event?: FormEvent, requestedPage = 1) => {
    event?.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true);
    setError("");
    setSearched(true);
    try {
      const response = await api.get<SearchResponse>("/documents/search", { params: { q: query.trim(), mode, page: requestedPage, limit: 10 } });
      setDocuments(response.data.documents);
      setResultMode(response.data.mode);
      setPage(response.data.page);
      setPages(response.data.pages);
      setTotal(response.data.total);
      setUnindexedDocuments(response.data.unindexedDocuments ?? 0);
    } catch (searchError) {
      setError(errorMessage(searchError));
      setDocuments([]);
      setPages(0);
      setTotal(0);
      setUnindexedDocuments(0);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="search-page">
      <div className="page-intro">
        <p className="eyebrow">FIND WHAT YOU NEED</p>
        <h1>Search your documents</h1>
        <p>Look up invoice details by keyword or describe what you’re looking for in plain language.</p>
      </div>
      <form className="search-card card" onSubmit={(event) => void search(event)}>
        <label className="search-input-wrap">
          <Search size={19} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Acme invoices from March over $500" />
          {query && <button type="button" className="clear-search" onClick={() => setQuery("")}>Clear</button>}
        </label>
        <div className="search-actions">
          <div className="segmented-control" role="group" aria-label="Search type">
            <button type="button" className={mode === "semantic" ? "active" : ""} onClick={() => setMode("semantic")}><Sparkles size={14} /> Semantic</button>
            <button type="button" className={mode === "keyword" ? "active" : ""} onClick={() => setMode("keyword")}>Keywords</button>
          </div>
          <button type="submit" className="button button-primary" disabled={!query.trim() || loading}>
            {loading ? <><LoaderCircle size={16} className="spin" /> Searching…</> : <><Search size={16} /> Search documents</>}
          </button>
        </div>
        <p className="search-hint">{mode === "semantic" ? "Semantic search compares Gemini query embeddings with vectors stored in your local MongoDB." : "Keyword search matches invoice numbers, suppliers, customers, and extracted text."}</p>
      </form>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {searched && !loading && resultMode === "semantic" && unindexedDocuments > 0 && (
        <div className="fallback-note" role="status">
          {unindexedDocuments} {unindexedDocuments === 1 ? "document has" : "documents have"} no valid stored embedding and {unindexedDocuments === 1 ? "is" : "are"} excluded from semantic results.
        </div>
      )}
      {searched && !loading && (
        <section className="search-results">
          <div className="results-heading"><h2>Results</h2><span>{total} documents</span></div>
          {documents.length ? (
            <div className="results-list card">
              {documents.map((document) => (
                <button type="button" className="search-result" key={document._id} onClick={() => onSelect(document._id)}>
                  <span className="result-leading"><Search size={16} /></span>
                  <span className="result-content">
                    <strong>{document.extraction?.supplierName || document.originalName}</strong>
                    <span>{document.originalName} · Invoice {document.extraction?.invoiceNumber || "—"} · {document.extraction?.invoiceDate || ""}</span>
                    {resultMode === "semantic" && document.score !== undefined && (
                      <span className="similarity-score">Similarity {(Math.max(0, document.score) * 100).toFixed(1)}%</span>
                    )}
                  </span>
                  <span className="result-amount">{document.extraction?.total == null ? "—" : `${document.extraction.currency ?? ""} ${document.extraction.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}</span>
                  <span className="result-date">{document.createdAt ? format(new Date(document.createdAt), "MMM dd, yyyy") : ""}</span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
          ) : <div className="empty-state card"><strong>No matching documents</strong><span>Try a different phrase or switch search modes.</span></div>}
          {pages > 1 && (
            <div className="search-pagination" aria-label="Search result pages">
              <button type="button" className="button button-secondary" disabled={loading || page <= 1} onClick={() => void search(undefined, page - 1)}>Previous</button>
              <span>Page {page} of {pages}</span>
              <button type="button" className="button button-secondary" disabled={loading || page >= pages} onClick={() => void search(undefined, page + 1)}>Next</button>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
