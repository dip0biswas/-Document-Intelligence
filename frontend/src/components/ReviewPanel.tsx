import { useEffect, useState, type FormEvent } from "react";
import { format } from "date-fns";
import { AlertTriangle, ArrowLeft, Check, ExternalLink, LoaderCircle, RotateCw, Save } from "lucide-react";
import { api, errorMessage } from "../api";
import type { DocumentRecord, DocumentStatus, InvoiceLineItem } from "../types";

type Props = { documentId: string; onClose: () => void; onSaved: (status: DocumentStatus) => void; onReprocessed: () => void };
type EditableField = "invoiceNumber" | "invoiceDate" | "supplierName" | "customerName" | "subtotal" | "tax" | "total" | "currency";
type EditableLineItem = { description: string; quantity: string; unitPrice: string; amount: string };
const fields: Array<{ key: EditableField; label: string; type?: string }> = [
  { key: "invoiceNumber", label: "Invoice number" },
  { key: "invoiceDate", label: "Invoice date", type: "date" },
  { key: "supplierName", label: "Supplier" },
  { key: "customerName", label: "Customer" },
  { key: "subtotal", label: "Subtotal", type: "number" },
  { key: "tax", label: "Tax", type: "number" },
  { key: "total", label: "Total", type: "number" },
  { key: "currency", label: "Currency" }
];

export default function ReviewPanel({ documentId, onClose, onSaved, onReprocessed }: Props) {
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [values, setValues] = useState<Record<EditableField, string>>({
    invoiceNumber: "", invoiceDate: "", supplierName: "", customerName: "", subtotal: "", tax: "", total: "", currency: ""
  });
  const [lineItems, setLineItems] = useState<EditableLineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPreviewError("");
    api.get<{ document: DocumentRecord; queueState?: string }>(`/documents/${encodeURIComponent(documentId)}`)
      .then(({ data }) => {
        if (!active) return;
        const record = { ...data.document, queueState: data.queueState };
        setDocument(record);
        const extraction = record.extraction;
        setValues({
          invoiceNumber: extraction?.invoiceNumber ?? "",
          invoiceDate: extraction?.invoiceDate ?? "",
          supplierName: extraction?.supplierName ?? "",
          customerName: extraction?.customerName ?? "",
          subtotal: extraction?.subtotal == null ? "" : String(extraction.subtotal),
          tax: extraction?.tax == null ? "" : String(extraction.tax),
          total: extraction?.total == null ? "" : String(extraction.total),
          currency: extraction?.currency ?? ""
        });
        setLineItems((extraction?.lineItems ?? []).map((item) => ({
          description: item.description,
          quantity: item.quantity == null ? "" : String(item.quantity),
          unitPrice: item.unitPrice == null ? "" : String(item.unitPrice),
          amount: item.amount == null ? "" : String(item.amount)
        })));
      })
      .catch((loadError: unknown) => active && setError(errorMessage(loadError)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [documentId]);

  const updateField = (key: EditableField, value: string) => {
    setSaved(false);
    setValues((current) => ({ ...current, [key]: value }));
  };

  const updateLineItem = (index: number, key: keyof InvoiceLineItem, value: string) => {
    setSaved(false);
    setLineItems((current) => current.map((item, currentIndex) => {
      if (currentIndex !== index) return item;
      return { ...item, [key]: value };
    }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!document || saving) return;
    setSaving(true);
    setError("");
    try {
      const extraction = {
        invoiceNumber: values.invoiceNumber || null,
        invoiceDate: values.invoiceDate || null,
        supplierName: values.supplierName || null,
        customerName: values.customerName || null,
        subtotal: values.subtotal || null,
        tax: values.tax || null,
        total: values.total || null,
        currency: values.currency || null,
        lineItems
      };
      const response = await api.put<{ document: DocumentRecord }>(`/documents/corrections/${encodeURIComponent(documentId)}`, { extraction });
      setDocument(response.data.document);
      setSaved(true);
      onSaved(response.data.document.status);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const retryProcessing = async () => {
    if (reprocessing) return;
    setReprocessing(true);
    setError("");
    try {
      await api.post(`/documents/reprocess/${encodeURIComponent(documentId)}`);
      onReprocessed();
    } catch (retryError) {
      setError(errorMessage(retryError));
    } finally {
      setReprocessing(false);
    }
  };

  if (loading) {
    return <div className="review-loading"><LoaderCircle className="spin" /> Loading document review…</div>;
  }
  if (!document) {
    return <div className="review-error"><button type="button" className="button button-secondary" onClick={onClose}><ArrowLeft size={16} /> Back</button><p>{error || "Document could not be loaded."}</p></div>;
  }

  const fileUrl = `${api.defaults.baseURL}/documents/${encodeURIComponent(documentId)}/file`;
  const previewIsImage = /^image\/(jpeg|png|tiff?)$/i.test(document.mimeType) || /\.(jpe?g|png|tiff?)$/i.test(document.originalName);
  const previewIsPdf = document.mimeType === "application/pdf" || /\.pdf$/i.test(document.originalName);
  const previewTables = document.tables ?? [];
  const previewText = document.extractedText?.trim();

  return (
    <div className="review-view">
      <div className="review-toolbar">
        <button type="button" className="button button-secondary" onClick={onClose}><ArrowLeft size={16} /> All documents</button>
        <div className="review-title"><span className="eyebrow">DOCUMENT REVIEW</span><strong title={document.originalName}>{document.originalName}</strong></div>
        <span className={`status-badge status-${document.status}`}><span />{document.status.replace("_", " ")}</span>
      </div>
        {(document.status === "failed" || (["pending", "processing"].includes(document.status) && document.queueState === "failed")) && (
          <div className="banner-error failed-document-alert" role="alert">
            <div>
              <strong>Processing failed.</strong>{" "}
              {document.processingHistory?.filter((entry) => entry.status === "failed" || entry.message.startsWith("Attempt ")).at(-1)?.message
                || "No failure details were saved. You can still review the source file and enter corrections."}
            </div>
            <button type="button" className="button button-secondary retry-processing" disabled={reprocessing} onClick={() => void retryProcessing()}>
              {reprocessing ? <><LoaderCircle className="spin" size={14} /> Retrying…</> : <><RotateCw size={14} /> Retry processing</>}
            </button>
          </div>
        )}
        <div className="review-grid">
        <section className="preview-pane card">
          <div className="panel-heading">
            <div><p className="eyebrow">SOURCE FILE</p><h2>Original document</h2></div>
            <div className="preview-heading-actions">
              <span className="mono tiny">{format(new Date(document.createdAt), "MMM dd, yyyy")}</span>
              <a className="preview-open" href={fileUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open file</a>
            </div>
          </div>
          <div className="document-preview">
            {previewError ? (
              <div className="preview-fallback">
                <p>{previewError}</p>
                {previewText ? <pre>{previewText}</pre> : <span>{document.originalName} · {document.mimeType}</span>}
              </div>
            ) : previewIsPdf ? (
              <iframe title={`Preview of ${document.originalName}`} src={fileUrl} onError={() => setPreviewError("The PDF could not be displayed here. Open the source file to view it.")} />
            ) : previewIsImage ? (
              <img src={fileUrl} alt={`Uploaded source ${document.originalName}`} onError={() => setPreviewError("This image format cannot be displayed here. Extracted content is shown when available.")} />
            ) : previewTables.length > 0 ? (
              <div className="source-tables">
                {previewTables.map((table, tableIndex) => {
                  const columns = table.columns.slice(0, 12);
                  const rows = table.rows.slice(0, 100);
                  return (
                    <section className="source-table" key={`${table.name}-${tableIndex}`}>
                      <h3>{table.name}</h3>
                      <div className="source-table-scroll">
                        <table>
                          <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                          <tbody>
                            {rows.map((row, rowIndex) => (
                              <tr key={rowIndex}>{columns.map((column) => {
                                const value = row[column];
                                return <td key={column}>{value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value)}</td>;
                              })}</tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {(table.rows.length > rows.length || table.columns.length > columns.length) && (
                        <p className="source-table-note">Showing the first {rows.length} rows and {columns.length} columns.</p>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : previewText ? (
              <pre>{previewText}</pre>
            ) : (
              <div className="preview-empty">
                <strong>{document.originalName}</strong>
                <span>Preview content is not available yet. Open the source file to view it.</span>
              </div>
            )}
          </div>
        </section>
        <form className="review-form card" onSubmit={(event) => void save(event)}>
          <div className="panel-heading">
            <div><p className="eyebrow">EXTRACTED INFORMATION</p><h2>Review &amp; correct</h2></div>
            <span className="ai-chip"><span /> AI extracted</span>
          </div>
          {document.validationErrors.length > 0 && (
            <div className="validation-alert">
              <div className="alert-title"><AlertTriangle size={16} /> Needs your attention <span>{document.validationErrors.length}</span></div>
              <ul>{document.validationErrors.map((message) => <li key={message}>{message}</li>)}</ul>
            </div>
          )}
          <div className="fields-grid">
            {fields.map((field) => (
              <label className="field" key={field.key}>
                <span>{field.label}</span>
                <input
                  type={field.type ?? "text"}
                  step={field.type === "number" ? "any" : undefined}
                  value={values[field.key]}
                  onChange={(event) => updateField(field.key, event.target.value)}
                  placeholder="Not found"
                />
              </label>
            ))}
          </div>
          <div className="line-items-heading"><div><strong>Line items</strong><span>{lineItems.length} found</span></div></div>
          {lineItems.length > 0 ? (
            <div className="line-items-scroll">
              <table className="line-items-table">
                <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
                <tbody>
                  {lineItems.map((item, index) => (
                    <tr key={`${index}-${item.description}`}>
                      <td><input aria-label={`Line item ${index + 1} description`} value={item.description} onChange={(event) => updateLineItem(index, "description", event.target.value)} /></td>
                      <td><input aria-label={`Line item ${index + 1} quantity`} inputMode="decimal" value={item.quantity ?? ""} onChange={(event) => updateLineItem(index, "quantity", event.target.value)} /></td>
                      <td><input aria-label={`Line item ${index + 1} unit price`} inputMode="decimal" value={item.unitPrice ?? ""} onChange={(event) => updateLineItem(index, "unitPrice", event.target.value)} /></td>
                      <td><input aria-label={`Line item ${index + 1} amount`} inputMode="decimal" value={item.amount ?? ""} onChange={(event) => updateLineItem(index, "amount", event.target.value)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="no-items">No line items were identified.</p>}
          {error && <p className="inline-error" role="alert">{error}</p>}
          {saved && <p className="inline-success"><Check size={15} /> Corrections saved. Validation has been rerun.</p>}
          <div className="form-footer">
            <p>Changes are revalidated before they are saved.</p>
            <button type="submit" className="button button-primary" disabled={saving}>
              {saving ? <><LoaderCircle className="spin" size={16} /> Saving…</> : <><Save size={16} /> Save corrections</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
