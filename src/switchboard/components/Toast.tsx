import { toast } from "../store.ts";
import { dismissToast, undoToast } from "../actions.ts";

export function Toast() {
  if (!toast.value) return null;

  return (
    <div
      className="sb-sbin"
      style={{
        position: "absolute",
        bottom: 18,
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--sb-primary)",
        color: "#fff",
        borderRadius: 10,
        padding: "10px 8px 10px 16px",
        display: "flex",
        gap: 4,
        alignItems: "center",
        boxShadow: "var(--sb-shadow-toast)",
        zIndex: 30,
      }}
    >
      <span style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{toast.value.label}</span>
      {toast.value.undo && (
        <button
          type="button"
          onClick={undoToast}
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: "var(--sb-toast-accent)",
            cursor: "pointer",
            padding: "4px 10px",
            borderRadius: 6,
          }}
        >
          Undo
        </button>
      )}
      <button
        type="button"
        onClick={dismissToast}
        style={{ fontSize: 13, color: "var(--sb-text-5)", cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}
      >
        ✕
      </button>
    </div>
  );
}
