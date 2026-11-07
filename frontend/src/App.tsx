import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownToLine, ArrowUpRight, CheckCircle2, Clock3, FileCheck2, FileClock, FileText, Moon,
  Search, ShieldCheck, Sun, Upload, WalletCards
} from "lucide-react";
import { format } from "date-fns";
import { api, errorMessage } from "./api";
import DocumentsTable from "./components/DocumentsTable";
import ReviewPanel from "./components/ReviewPanel";
import SearchPanel from "./components/SearchPanel";
import UploadZone from "./components/UploadZone";
import type { DocumentRecord } from "./types";

type View = "dashboard" | "processing" | "reviews" | "completed" | "search";

function StatCard({ label, value, note, icon: Icon, tone }: {
  label: string;
  value: number;
  note: string;
  icon: typeof FileText;
  tone: string;
}) {
  return (
    <article className="stat-card card">
      <div className={`stat-icon ${tone}`}><Icon size={18} /></div>
      <div className="stat-copy"><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{note}</small></div>
      <ArrowUpRight size={15} className="stat-arrow" />
    </article>
  );
}

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [recentUploadIds, setRecentUploadIds] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const [darkMode, setDarkMode] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get<{ documents: DocumentRecord[]; total: number }>("/documents/results", { params: { page: 1, limit: 100 } });
      setDocuments(response.data.documents);
      setTotal(response.data.total);
      setError("");
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUpload = useCallback((documentIds?: string[], uploadFailures?: string[]) => {
    if (documentIds?.length) {
      setLoading(true);
      setRecentUploadIds(documentIds);
      setUploadNotice(uploadFailures?.length ? `Some files could not be uploaded: ${uploadFailures.join(" · ")}` : "");
      setSelectedId(null);
      setView("processing");
    }
    void refresh();
  }, [refresh]);
  const hasActiveProcessing = documents.some((item) => ["pending", "processing"].includes(item.status));

  useEffect(() => {
    const savedTheme = localStorage.getItem("ledgerlens-theme");
    const enabled = savedTheme ? savedTheme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDarkMode(enabled);
    document.documentElement.classList.toggle("dark", enabled);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), hasActiveProcessing ? 1500 : 5000);
    return () => window.clearInterval(timer);
  }, [refresh, hasActiveProcessing]);

  const toggleTheme = () => {
    setDarkMode((current) => {
      const next = !current;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("ledgerlens-theme", next ? "dark" : "light");
      return next;
    });
  };

  const openReview = (id: string) => {
    setSelectedId(id);
  };
  const needsReview = documents.filter((item) => item.status === "requires_review").length;
  const processing = documents.filter((item) => ["pending", "processing"].includes(item.status)).length;
  const completed = documents.filter((item) => item.status === "completed").length;
  const processingDocuments = documents.filter((item) =>
    ["pending", "processing"].includes(item.status) || recentUploadIds.includes(item._id)
  );
  const reviewDocuments = documents.filter((item) =>
    item.status === "requires_review" || item.status === "failed"
  );
  const completedDocuments = documents.filter((item) => item.status === "completed");
  const newestDate = documents[0]?.createdAt ? format(new Date(documents[0].createdAt), "MMM dd, yyyy") : "No uploads yet";
  const goToView = (nextView: View) => {
    setSelectedId(null);
    setView(nextView);
  };
  const returnToProcessing = () => {
    goToView("processing");
    void refresh();
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="#" className="brand" onClick={(event) => { event.preventDefault(); goToView("dashboard"); }}>
          <span className="brand-mark"><WalletCards size={21} /></span>
          <span>ledger<span>lens</span><small>DOCUMENT INTELLIGENCE</small></span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button type="button" className={`nav-item ${view === "dashboard" && !selectedId ? "nav-active" : ""}`} onClick={() => goToView("dashboard")}>
            <FileText size={17} /> Overview
          </button>
          <button type="button" className={`nav-item ${view === "processing" ? "nav-active" : ""}`} onClick={() => goToView("processing")}>
            <Clock3 size={17} /> Processing <span className="nav-count">{processing}</span>
          </button>
          <button type="button" className={`nav-item ${view === "reviews" ? "nav-active" : ""}`} onClick={() => goToView("reviews")}>
            <FileCheck2 size={17} /> Reviews <span className="nav-count">{reviewDocuments.length}</span>
          </button>
          <button type="button" className={`nav-item ${view === "completed" ? "nav-active" : ""}`} onClick={() => goToView("completed")}>
            <CheckCircle2 size={17} /> Completed <span className="nav-count">{completed}</span>
          </button>
          <button type="button" className={`nav-item ${view === "search" ? "nav-active" : ""}`} onClick={() => goToView("search")}>
            <Search size={17} /> Search documents
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <span className="privacy-icon"><ShieldCheck size={17} /></span>
            <strong>Private by design</strong>
            <p>Your financial documents stay in your workspace.</p>
          </div>
          <div className="profile-row"><span className="avatar">LL</span><span><strong>LedgerLens</strong><small>Workspace</small></span><span className="online-dot" /></div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{selectedId ? "Document review" : view === "search" ? "Search" : view === "processing" ? "Processing" : view === "reviews" ? "Reviews" : view === "completed" ? "Completed" : "Overview"}</strong></div>
          <div className="topbar-actions">
            <span className="today-label">{format(new Date(), "EEEE, MMMM dd")}</span>
            <button type="button" className="icon-button theme-toggle" aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="top-avatar">LL</div>
          </div>
        </header>
        {selectedId ? (
          <ReviewPanel
            documentId={selectedId}
            onClose={() => setSelectedId(null)}
            onSaved={(status) => {
              setSelectedId(null);
              setView(status === "completed" ? "completed" : "reviews");
              void refresh();
            }}
            onReprocessed={returnToProcessing}
          />
        ) : view === "search" ? (
          <SearchPanel onSelect={openReview} />
        ) : view === "processing" ? (
          <section className="queue-page">
            <div className="page-intro">
              <p className="eyebrow">DOCUMENT WORKFLOW</p>
              <h1>Processing</h1>
              <p>Track uploads while their text and invoice details are being extracted. This list refreshes automatically.</p>
            </div>
            {uploadNotice && <div className="banner-error" role="alert">{uploadNotice}</div>}
            {error && <div className="banner-error" role="alert"><strong>Couldn’t refresh processing status.</strong> {error} <button type="button" onClick={() => void refresh()}>Retry</button></div>}
            <section className="documents-section card">
              <div className="section-heading table-heading">
                <div><p className="eyebrow">UPLOAD QUEUE</p><h2>Recent uploads <span className="count-pill">{processingDocuments.length}</span></h2></div>
                <button className="text-button" type="button" onClick={() => goToView("dashboard")}><Upload size={15} /> Upload more</button>
              </div>
              {loading ? <div className="table-loading"><span className="spinner-small" /> Loading documents…</div> : processingDocuments.length ? (
                <DocumentsTable documents={processingDocuments} onSelect={openReview} />
              ) : (
                <div className="empty-state"><div className="empty-icon"><Clock3 size={20} /></div><strong>Nothing is processing</strong><span>New uploads will appear here with their live status.</span></div>
              )}
            </section>
          </section>
        ) : view === "reviews" ? (
          <section className="queue-page">
            <div className="page-intro">
              <p className="eyebrow">CHECK AND CORRECT</p>
              <h1>Review documents</h1>
              <p>Open a document to inspect its source, correct extracted fields, and save. Failed documents are included so you can inspect their available content.</p>
            </div>
            {error && <div className="banner-error" role="alert"><strong>Couldn’t refresh the review queue.</strong> {error} <button type="button" onClick={() => void refresh()}>Retry</button></div>}
            <section className="documents-section card">
              <div className="section-heading table-heading">
                <div><p className="eyebrow">NEEDS ATTENTION</p><h2>Review queue <span className="count-pill">{reviewDocuments.length}</span></h2></div>
              </div>
              {loading ? <div className="table-loading"><span className="spinner-small" /> Loading documents…</div> : reviewDocuments.length ? (
                <DocumentsTable documents={reviewDocuments} onSelect={openReview} />
              ) : (
                <div className="empty-state"><div className="empty-icon"><FileCheck2 size={20} /></div><strong>You’re all caught up</strong><span>Documents that need correction will appear here.</span></div>
              )}
            </section>
          </section>
        ) : view === "completed" ? (
          <section className="queue-page">
            <div className="page-intro">
              <p className="eyebrow">WORKFLOW COMPLETE</p>
              <h1>Completed documents</h1>
              <p>Documents that passed validation after extraction or review are ready here.</p>
            </div>
            {error && <div className="banner-error" role="alert"><strong>Couldn’t refresh completed documents.</strong> {error} <button type="button" onClick={() => void refresh()}>Retry</button></div>}
            <section className="documents-section card">
              <div className="section-heading table-heading">
                <div><p className="eyebrow">READY IN YOUR WORKSPACE</p><h2>Completed <span className="count-pill">{completedDocuments.length}</span></h2></div>
              </div>
              {loading ? <div className="table-loading"><span className="spinner-small" /> Loading documents…</div> : completedDocuments.length ? (
                <DocumentsTable documents={completedDocuments} onSelect={openReview} />
              ) : (
                <div className="empty-state"><div className="empty-icon"><CheckCircle2 size={20} /></div><strong>No completed documents yet</strong><span>Documents move here after processing or after corrections pass validation.</span></div>
              )}
            </section>
          </section>
        ) : (
          <div className="page-content">
            <section className="welcome-row">
              <div><p className="eyebrow">YOUR FINANCE WORKSPACE</p><h1>Good morning<span className="period">.</span></h1><p>Keep every invoice organized, accurate, and easy to find.</p></div>
              <button type="button" className="button button-secondary export-button" onClick={() => window.print()}><ArrowDownToLine size={16} /> Export overview</button>
            </section>
            <section className="stats-grid" aria-label="Document summary">
              <StatCard label="Total documents" value={total} note="All documents received" icon={FileText} tone="icon-blue" />
              <StatCard label="Processed" value={completed} note="Ready in your workspace" icon={FileCheck2} tone="icon-green" />
              <StatCard label="Needs review" value={needsReview} note="Waiting for your attention" icon={FileClock} tone="icon-amber" />
              <StatCard label="In progress" value={processing} note={`Latest activity ${newestDate}`} icon={Upload} tone="icon-violet" />
            </section>
            {error && <div className="banner-error" role="alert"><strong>Couldn’t refresh documents.</strong> {error} <button type="button" onClick={() => void refresh()}>Retry</button></div>}
            <UploadZone onUploaded={handleUpload} />
            <section className="documents-section card">
              <div className="section-heading table-heading">
                <div><p className="eyebrow">YOUR WORKSPACE</p><h2>Recent documents <span className="count-pill">{total}</span></h2></div>
                <button className="text-button" type="button" onClick={() => setView("search")}>Search all documents <ArrowUpRight size={15} /></button>
              </div>
              {loading ? <div className="table-loading"><span className="spinner-small" /> Loading documents…</div> : <DocumentsTable documents={documents.slice(0, 10)} onSelect={openReview} />}
              {!loading && total > 10 && <div className="table-footer"><span>Showing 10 of {total} documents</span><button type="button" onClick={() => setView("search")}>View all <ArrowUpRight size={14} /></button></div>}
            </section>
            <footer className="page-footer"><span>LedgerLens · AI-assisted document intelligence</span><span><span className="footer-dot" /> All systems operational</span></footer>
          </div>
        )}
      </main>
    </div>
  );
}
