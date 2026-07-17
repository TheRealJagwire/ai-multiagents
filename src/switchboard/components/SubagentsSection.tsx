import type { Effort } from "../types.ts";
import {
  subagentDeleteConfirm,
  subagentEditingId,
  subagentFormDescription,
  subagentFormEffort,
  subagentFormModel,
  subagentFormName,
  subagentFormPrompt,
  subagents,
} from "../store.ts";
import {
  askDeleteSubagent,
  cancelDeleteSubagent,
  cancelEditSubagent,
  confirmDeleteSubagent,
  startEditSubagent,
  submitSubagent,
} from "../actions.ts";
import { chipState, effortLabel, modelLabel } from "../format.ts";
import { chipStyle } from "./TeamMemberRow.tsx";
import { ModelSelect } from "./ModelSelect.tsx";

const EFFORTS: Effort[] = ["low", "medium", "high"];

const inputStyle = {
  border: "1px solid var(--sb-border-3)",
  borderRadius: 9,
  padding: "8px 12px",
  fontSize: 12.5,
  fontFamily: "var(--sb-font-sans)",
  outline: "none",
  color: "var(--sb-text-1)",
  background: "var(--sb-surface)",
};

const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--sb-text-3)" };

// Subagent presets: a named system prompt + default model/effort. Library
// only for now — a preset picker in the spawn form is the follow-up.
export function SubagentsSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 11.5, color: "var(--sb-text-4)", lineHeight: 1.5 }}>
        Named presets for the kinds of agents you spawn repeatedly — a reviewer, a docs writer, a test fixer. Each
        carries a system prompt plus a default model and effort. Picking a preset in the spawn form is coming next.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {subagents.value.length === 0
          ? <div style={{ fontSize: 12, color: "var(--sb-text-5)", padding: "6px 0" }}>No subagent presets yet.</div>
          : subagents.value.map((subagent) => (
            <div
              key={subagent.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                border: "1px solid var(--sb-border-2)",
                borderRadius: 9,
                padding: "9px 11px",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{subagent.name}</span>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: ".05em",
                      color: "var(--sb-text-4)",
                      background: "var(--sb-surface-3)",
                      padding: "2px 7px",
                      borderRadius: 6,
                    }}
                  >
                    {modelLabel(subagent.model).toUpperCase()} · {effortLabel(subagent.effort).toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: 10.5, color: "var(--sb-text-5)", paddingTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {subagent.description || subagent.systemPrompt.slice(0, 80)}
                </div>
              </div>
              {subagentDeleteConfirm.value === subagent.id
                ? (
                  <div style={{ display: "flex", gap: 6, flex: "none" }}>
                    <button
                      type="button"
                      onClick={() => confirmDeleteSubagent(subagent.id)}
                      style={{ fontSize: 11, fontWeight: 600, color: "var(--sb-on-primary)", background: "var(--sb-error-dot)", padding: "4px 11px", borderRadius: 7, cursor: "pointer" }}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={cancelDeleteSubagent}
                      style={{ fontSize: 11, fontWeight: 600, color: "var(--sb-text-3)", border: "1px solid var(--sb-border-3)", padding: "4px 11px", borderRadius: 7, cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  </div>
                )
                : (
                  <div style={{ display: "flex", gap: 6, flex: "none" }}>
                    <button
                      type="button"
                      onClick={() => startEditSubagent(subagent)}
                      style={{ fontSize: 11, fontWeight: 600, color: "var(--sb-text-3)", border: "1px solid var(--sb-border-3)", padding: "4px 11px", borderRadius: 7, cursor: "pointer" }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => askDeleteSubagent(subagent.id)}
                      style={{ fontSize: 11, fontWeight: 600, color: "var(--sb-error-text)", border: "1px solid var(--sb-red-tint-4)", padding: "4px 11px", borderRadius: 7, cursor: "pointer" }}
                    >
                      Delete
                    </button>
                  </div>
                )}
            </div>
          ))}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          border: "1px solid var(--sb-border-2)",
          borderRadius: 10,
          padding: "14px 14px",
          background: "var(--sb-bg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
            {subagentEditingId.value ? "Edit subagent" : "Add a subagent"}
          </div>
          {subagentEditingId.value && (
            <button type="button" onClick={cancelEditSubagent} style={{ fontSize: 11, color: "var(--sb-blue)", cursor: "pointer" }}>
              Cancel edit
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
            <div style={labelStyle}>Name</div>
            <input
              placeholder="e.g. Reviewer"
              value={subagentFormName.value}
              onInput={(e) => {
                subagentFormName.value = (e.target as HTMLInputElement).value;
              }}
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 2 }}>
            <div style={labelStyle}>Description</div>
            <input
              placeholder="One line on what this agent is for"
              value={subagentFormDescription.value}
              onInput={(e) => {
                subagentFormDescription.value = (e.target as HTMLInputElement).value;
              }}
              style={inputStyle}
            />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={labelStyle}>System prompt</div>
          <textarea
            placeholder="Replaces the default worker system prompt for sessions spawned as this subagent."
            value={subagentFormPrompt.value}
            onInput={(e) => {
              subagentFormPrompt.value = (e.target as HTMLTextAreaElement).value;
            }}
            style={{ ...inputStyle, resize: "none", height: 90 }}
          />
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", color: "var(--sb-text-5)", marginRight: 3 }}>MODEL</span>
            <ModelSelect value={subagentFormModel.value} onChange={(m) => (subagentFormModel.value = m)} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", color: "var(--sb-text-5)", marginRight: 3 }}>EFFORT</span>
            {EFFORTS.map((e) => (
              <button
                type="button"
                key={e}
                onClick={() => {
                  subagentFormEffort.value = e;
                }}
                style={chipStyle(chipState(subagentFormEffort.value === e, false))}
              >
                {effortLabel(e)}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void submitSubagent()}
          disabled={!subagentFormName.value.trim()}
          style={{
            alignSelf: "flex-start",
            padding: "7px 16px",
            background: subagentFormName.value.trim() ? "var(--sb-primary)" : "var(--sb-surface-3)",
            color: subagentFormName.value.trim() ? "var(--sb-on-primary)" : "var(--sb-text-5)",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: subagentFormName.value.trim() ? "pointer" : "not-allowed",
          }}
        >
          {subagentEditingId.value ? "Save changes" : "+ Add subagent"}
        </button>
      </div>
    </div>
  );
}
