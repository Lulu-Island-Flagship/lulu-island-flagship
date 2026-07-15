import { describe, it } from "node:test";
import assert from "node:assert";
import { suggestNotesForContext, groupNotesByEntity, type EntityNote } from "../../src/lib/entity-notes";

const sample: EntityNote[] = [
  { id: "1", entityType: "employee", entityId: "e1", note: "no con Pedro", suggestContext: ["dispatch"] },
  { id: "2", entityType: "client_property", entityId: "p1", note: "escaleras empinadas", suggestContext: ["checkin", "servicio"] },
  { id: "3", entityType: "employee", entityId: "e1", note: "nota general sin contexto", suggestContext: [] },
];

describe("suggestNotesForContext", () => {
  it("filtra solo las notas que declaran el contexto", () => {
    const r = suggestNotesForContext(sample, "dispatch");
    assert.equal(r.length, 1);
    assert.equal(r[0].id, "1");
  });

  it("una nota sin contexto declarado nunca se sugiere", () => {
    const r = suggestNotesForContext(sample, "dispatch");
    assert.ok(!r.some((n) => n.id === "3"));
  });

  it("una nota con múltiples contextos aparece en cualquiera de ellos", () => {
    assert.equal(suggestNotesForContext(sample, "checkin").length, 1);
    assert.equal(suggestNotesForContext(sample, "servicio").length, 1);
  });

  it("contexto sin coincidencias = lista vacía", () => {
    assert.equal(suggestNotesForContext(sample, "unknown_context").length, 0);
  });
});

describe("groupNotesByEntity", () => {
  it("agrupa por entityType:entityId", () => {
    const g = groupNotesByEntity(sample);
    assert.equal(g.get("employee:e1")?.length, 2);
    assert.equal(g.get("client_property:p1")?.length, 1);
  });
});
