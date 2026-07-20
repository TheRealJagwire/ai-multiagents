import { toasts } from "../store.ts";
import { dismissToast, undoToast } from "../actions.ts";

export function Toast() {
  if (toasts.value.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 18,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "center",
        zIndex: 30,
      }}
    >
      {toasts.value.map((t) => (
        <div
          key={t.id}
          className="sb-sbin"
          style={{
            background: "var(--sb-primary)",
            color: "var(--sb-on-primary)",
            borderRadius: 10,
            padding: "10px 8px 10px 16px",
            display: "flex",
            gap: 4,
            alignItems: "center",
            boxShadow: "var(--sb-shadow-toast)",
          }}
        >
          <span style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{t.label}</span>
          {t.undo && (
            <button
              type="button"
              onClick={() => undoToast(t.id)}
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
            onClick={() => dismissToast(t.id)}
            style={{ fontSize: 13, color: "var(--sb-text-5)", cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
