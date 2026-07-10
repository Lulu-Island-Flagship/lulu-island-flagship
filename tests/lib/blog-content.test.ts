import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isSourceMetadataAnonymous,
  evaluatePostForApproval,
  approvePost,
  publishPost,
  rejectPost,
} from "../../src/lib/blog-content";

describe("isSourceMetadataAnonymous", () => {
  it("muestra de 1-2 no es anonima", () => {
    assert.equal(isSourceMetadataAnonymous({ triggerType: "mold", sampleSize: 1 }), false);
    assert.equal(isSourceMetadataAnonymous({ triggerType: "mold", sampleSize: 2 }), false);
  });

  it("muestra de 3+ si es anonima", () => {
    assert.equal(isSourceMetadataAnonymous({ triggerType: "mold", sampleSize: 3 }), true);
    assert.equal(isSourceMetadataAnonymous({ triggerType: "mold", sampleSize: 50 }), true);
  });
});

describe("evaluatePostForApproval", () => {
  it("post sin contenido nunca esta listo", () => {
    const r = evaluatePostForApproval({ content: "", sourceMetadata: { triggerType: "mold", sampleSize: 10 } });
    assert.equal(r.readyForApproval, false);
  });

  it("post con contenido limpio y metadata anonima esta listo", () => {
    const r = evaluatePostForApproval({
      content: "Basado en su historial de servicio, el moho superficial en baños aparece con ventilación pobre.",
      sourceMetadata: { triggerType: "mold", sampleSize: 10 },
    });
    assert.equal(r.readyForApproval, true);
    assert.deepEqual(r.pipaViolations, []);
  });

  it("post con contenido que viola PIPA no esta listo, aunque la metadata sea anonima", () => {
    const r = evaluatePostForApproval({
      content: "Detectamos alérgenos en la mayoría de los hogares que visitamos.",
      sourceMetadata: { triggerType: "allergens", sampleSize: 20 },
    });
    assert.equal(r.readyForApproval, false);
    assert.ok(r.pipaViolations.length > 0);
  });

  it("post con metadata NO anonima no esta listo, aunque el contenido sea limpio", () => {
    const r = evaluatePostForApproval({
      content: "Basado en su historial de servicio, recomendamos el protocolo profundo trimestral.",
      sourceMetadata: { triggerType: "rare_case", sampleSize: 1 },
    });
    assert.equal(r.readyForApproval, false);
    assert.ok(r.reasons.some((reason) => reason.includes("anónima")));
  });
});

describe("approvePost", () => {
  it("aprueba un post en pending_approval con adminId", () => {
    const r = approvePost({ status: "pending_approval" }, "admin-1");
    assert.equal(r.success, true);
    assert.equal(r.newStatus, "approved");
  });

  it("rechaza aprobar un draft crudo (defensa en profundidad, no se salta evaluatePostForApproval)", () => {
    const r = approvePost({ status: "draft" }, "admin-1");
    assert.equal(r.success, false);
  });

  it("rechaza aprobar sin adminId (aprobacion de un toque exige un humano identificado)", () => {
    const r = approvePost({ status: "pending_approval" }, "");
    assert.equal(r.success, false);
  });

  it("no se puede re-aprobar un post ya publicado", () => {
    const r = approvePost({ status: "published" }, "admin-1");
    assert.equal(r.success, false);
  });
});

describe("publishPost", () => {
  it("publica un post approved", () => {
    const r = publishPost({ status: "approved" });
    assert.equal(r.success, true);
    assert.equal(r.newStatus, "published");
  });

  it("no se puede publicar directo desde pending_approval (salta el punto humano)", () => {
    const r = publishPost({ status: "pending_approval" });
    assert.equal(r.success, false);
  });

  it("no se puede publicar un draft", () => {
    const r = publishPost({ status: "draft" });
    assert.equal(r.success, false);
  });
});

describe("rejectPost", () => {
  it("rechaza un pending_approval", () => {
    const r = rejectPost({ status: "pending_approval" });
    assert.equal(r.success, true);
    assert.equal(r.newStatus, "rejected");
  });

  it("no se puede rechazar un post ya publicado", () => {
    const r = rejectPost({ status: "published" });
    assert.equal(r.success, false);
  });
});
