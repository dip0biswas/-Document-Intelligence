import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, LoaderCircle, UploadCloud, X } from "lucide-react";
import { api, errorMessage } from "../api";

type UploadJob = { jobId: string; documentId: string; originalName: string; status: string };
type Props = { onUploaded: (documentIds?: string[], uploadFailures?: string[]) => void };
const allowed = ".pdf,.jpg,.jpeg,.png,.tif,.tiff,.xlsx,.xls,.csv";

export default function UploadZone({ onUploaded }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!jobs.some((job) => ["pending", "processing"].includes(job.status))) return;
    const timer = window.setInterval(async () => {
      try {
        const updated = await Promise.all(jobs.map(async (job) => {
          if (!["pending", "processing"].includes(job.status)) return job;
          const response = await api.get(`/documents/status/${encodeURIComponent(job.jobId)}`);
          return { ...job, status: response.data.status as string };
        }));
        setJobs(updated);
        onUploaded();
      } catch (pollError) {
        setError(errorMessage(pollError));
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [jobs, onUploaded]);

  const addFiles = (selected: FileList | File[]) => {
    const next = Array.from(selected);
    setFiles((current) => [...current, ...next].slice(0, 10));
    setError("");
  };

  const submit = async () => {
    if (!files.length || uploading) return;
    setUploading(true);
    setProgress(0);
    setError("");
    const body = new FormData();
    files.forEach((file) => body.append("files", file));
    try {
      const response = await api.post<{ documents: UploadJob[]; failures?: Array<{ originalName: string; error: string }> }>("/documents/upload", body, {
        onUploadProgress: (event) => {
          if (event.total) setProgress(Math.round((event.loaded * 100) / event.total));
        }
      });
      setJobs((current) => [...response.data.documents, ...current]);
      if (response.data.failures?.length) {
        setError(response.data.failures.map((failure) => `${failure.originalName}: ${failure.error}`).join(" · "));
      }
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      onUploaded(
        response.data.documents.map((document) => document.documentId),
        response.data.failures?.map((failure) => `${failure.originalName}: ${failure.error}`)
      );
    } catch (uploadError) {
      setError(errorMessage(uploadError));
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="card upload-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">INGEST DOCUMENTS</p>
          <h2>Bring your invoices in</h2>
        </div>
        <span className="secure-label"><span className="secure-dot" /> Private workspace</span>
      </div>
      <div
        className={`dropzone ${dragging ? "dropzone-active" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        <div className="upload-icon"><UploadCloud size={22} /></div>
        <div className="drop-copy">
          <strong>Drop files to start processing</strong>
          <span>PDF, images, Excel, or CSV · up to 25 MB per file</span>
        </div>
        <button className="button button-secondary browse-button" type="button" onClick={() => inputRef.current?.click()}>
          Browse files
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={allowed}
          multiple
          className="sr-only"
          onChange={(event) => event.target.files && addFiles(event.target.files)}
        />
      </div>
      {files.length > 0 && (
        <div className="selected-files">
          {files.map((file, index) => (
            <div className="selected-file" key={`${file.name}-${index}`}>
              <FileText size={16} />
              <span>{file.name}</span>
              <small>{(file.size / (1024 * 1024)).toFixed(1)} MB</small>
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>
                <X size={15} />
              </button>
            </div>
          ))}
          {uploading && <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>}
          <button className="button button-primary upload-submit" type="button" disabled={uploading} onClick={() => void submit()}>
            {uploading ? <><LoaderCircle className="spin" size={16} /> Uploading {progress}%</> : `Upload ${files.length} ${files.length === 1 ? "file" : "files"}`}
          </button>
        </div>
      )}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {jobs.length > 0 && (
        <div className="job-list" aria-live="polite">
          {jobs.slice(0, 5).map((job) => (
            <div className="job-row" key={job.jobId}>
              {["completed", "requires_review"].includes(job.status)
                ? job.status === "requires_review"
                  ? <AlertTriangle size={16} className="warning-icon" />
                  : <CheckCircle2 size={16} className="success-icon" />
                : ["failed"].includes(job.status)
                  ? <X size={16} className="error-icon" />
                  : <LoaderCircle size={16} className="spin muted-icon" />}
              <span className="job-name">{job.originalName}</span>
              <span className={`job-status status-${job.status}`}>{job.status.replace("_", " ")}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
