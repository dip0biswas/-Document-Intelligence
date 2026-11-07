import { format } from "date-fns";
import { ArrowUpRight, FileSpreadsheet, FileText } from "lucide-react";
import type { DocumentRecord } from "../types";

type Props = {
  documents: DocumentRecord[];
  onSelect: (id: string) => void;
};

function StatusBadge({ status }: { status: DocumentRecord["status"] }) {
  return <span className={`status-badge status-${status}`}><span />{status.replace("_", " ")}</span>;
}

export default function DocumentsTable({ documents, onSelect }: Props) {
  if (!documents.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><FileText size={20} /></div>
        <strong>No documents yet</strong>
        <span>Upload your first invoice and it will appear here.</span>
      </div>
    );
  }
  return (
    <div className="table-scroll">
      <table className="documents-table">
        <thead>
          <tr><th>DOCUMENT</th><th>SUPPLIER</th><th>INVOICE</th><th>AMOUNT</th><th>STATUS</th><th>PROGRESS</th><th>ADDED</th><th /></tr>
        </thead>
        <tbody>
          {documents.map((document) => {
            const spreadsheet = /\.(xlsx|xls|csv)$/i.test(document.originalName);
            return (
              <tr key={document._id} onClick={() => onSelect(document._id)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onSelect(document._id)}>
                <td>
                  <div className="file-cell">
                    <span className="file-type-icon">{spreadsheet ? <FileSpreadsheet size={16} /> : <FileText size={16} />}</span>
                    <span className="file-name">{document.originalName}</span>
                  </div>
                </td>
                <td>{document.extraction?.supplierName || <span className="muted">—</span>}</td>
                <td className="mono">{document.extraction?.invoiceNumber || <span className="muted">—</span>}</td>
                <td className="amount-cell">
                  {document.extraction?.total == null
                    ? <span className="muted">—</span>
                    : `${document.extraction.currency ?? ""} ${document.extraction.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </td>
                <td><StatusBadge status={document.status} /></td>
                <td>
                  {["pending", "processing"].includes(document.status) && (
                    <div className="document-progress">
                      <div className="document-progress-label">
                        <span>{document.processingProgress?.label || (document.status === "pending" ? "Waiting in queue" : "Starting…")}</span>
                        <strong>{document.processingProgress?.percent ?? 0}%</strong>
                      </div>
                      <div
                        className="document-progress-track"
                        role="progressbar"
                        aria-label={`Processing ${document.originalName}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={document.processingProgress?.percent ?? 0}
                      >
                        <span style={{ width: `${document.processingProgress?.percent ?? 0}%` }} />
                      </div>
                    </div>
                  )}
                </td>
                <td className="date-cell">{document.createdAt ? format(new Date(document.createdAt), "MMM dd, yyyy") : "—"}</td>
                <td><button className="icon-button row-open" type="button" aria-label={`${document.status === "completed" ? "Open" : "Review"} ${document.originalName}`} onClick={(event) => { event.stopPropagation(); onSelect(document._id); }}><ArrowUpRight size={16} /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
