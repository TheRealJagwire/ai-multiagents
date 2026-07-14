import {
  skillDeleteConfirm,
  skillEditingId,
  skillFormDescription,
  skillFormInstructions,
  skillFormName,
  skills,
} from "../store.ts";
import {
  askDeleteSkill,
  cancelDeleteSkill,
  cancelEditSkill,
  confirmDeleteSkill,
  startEditSkill,
  submitSkill,
} from "../actions.ts";

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

// Skills: reusable instruction snippets. Library-only for now — spawn-time
// attachment is the planned follow-up, so the copy says so honestly.
export function SkillsSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 11.5, color: "var(--sb-text-4)", lineHeight: 1.5 }}>
        Reusable instruction snippets for your agents — e.g. house code style, review checklists, deploy runbooks.
        Manage the library here; attaching skills to sessions at spawn time is coming next.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {skills.value.length === 0
          ? <div style={{ fontSize: 12, color: "var(--sb-text-5)", padding: "6px 0" }}>No skills yet.</div>
          : skills.value.map((skill) => (
            <div
              key={skill.id}
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
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{skill.name}</div>
                <div style={{ fontSize: 10.5, color: "var(--sb-text-5)", paddingTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {skill.description || skill.instructions.slice(0, 80)}
                </div>
              </div>
              {skillDeleteConfirm.value === skill.id
                ? (
                  <div style={{ display: "flex", gap: 6, flex: "none" }}>
                    <button
                      type="button"
                      onClick={() => confirmDeleteSkill(skill.id)}
                      style={{ fontSize: 11, fontWeight: 600, color: "var(--sb-on-primary)", background: "var(--sb-error-dot)", padding: "4px 11px", borderRadius: 7, cursor: "pointer" }}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={cancelDeleteSkill}
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
                      onClick={() => startEditSkill(skill)}
                      style={{ fontSize: 11, fontWeight: 600, color: "var(--sb-text-3)", border: "1px solid var(--sb-border-3)", padding: "4px 11px", borderRadius: 7, cursor: "pointer" }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => askDeleteSkill(skill.id)}
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
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>{skillEditingId.value ? "Edit skill" : "Add a skill"}</div>
          {skillEditingId.value && (
            <button type="button" onClick={cancelEditSkill} style={{ fontSize: 11, color: "var(--sb-blue)", cursor: "pointer" }}>
              Cancel edit
            </button>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={labelStyle}>Name</div>
          <input
            placeholder="e.g. House code style"
            value={skillFormName.value}
            onInput={(e) => {
              skillFormName.value = (e.target as HTMLInputElement).value;
            }}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={labelStyle}>Description (shown in lists)</div>
          <input
            placeholder="One line on when to use it"
            value={skillFormDescription.value}
            onInput={(e) => {
              skillFormDescription.value = (e.target as HTMLInputElement).value;
            }}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={labelStyle}>Instructions</div>
          <textarea
            placeholder="The instructions appended to the agent's system prompt when this skill is attached."
            value={skillFormInstructions.value}
            onInput={(e) => {
              skillFormInstructions.value = (e.target as HTMLTextAreaElement).value;
            }}
            style={{ ...inputStyle, resize: "none", height: 90 }}
          />
        </div>
        <button
          type="button"
          onClick={() => void submitSkill()}
          disabled={!skillFormName.value.trim()}
          style={{
            alignSelf: "flex-start",
            padding: "7px 16px",
            background: skillFormName.value.trim() ? "var(--sb-primary)" : "var(--sb-surface-3)",
            color: skillFormName.value.trim() ? "var(--sb-on-primary)" : "var(--sb-text-5)",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: skillFormName.value.trim() ? "pointer" : "not-allowed",
          }}
        >
          {skillEditingId.value ? "Save changes" : "+ Add skill"}
        </button>
      </div>
    </div>
  );
}
