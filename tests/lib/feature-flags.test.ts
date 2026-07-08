/**
 * v8.3 E0-C4 — Test de CONTRATO de feature flags.
 * Criterio E0: "un feature flag apagado oculta su funcionalidad sin romper el resto".
 * El contrato es fail-closed: apagado, inexistente, borrado o con error => false, sin excepciones.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isFlagEnabled, type FlagClient } from "../../src/lib/feature-flags";

function fakeClient(result: {
  data: { activo: boolean | null } | null;
  error: { message: string } | null;
  throws?: boolean;
}): FlagClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => {
              if (result.throws) throw new Error("network down");
              return { data: result.data, error: result.error };
            },
          }),
        }),
      }),
    }),
  };
}

test("flag encendido => true", async () => {
  assert.equal(
    await isFlagEnabled(fakeClient({ data: { activo: true }, error: null }), "x"),
    true
  );
});

test("flag apagado => false (funcionalidad oculta)", async () => {
  assert.equal(
    await isFlagEnabled(fakeClient({ data: { activo: false }, error: null }), "x"),
    false
  );
});

test("flag inexistente => false (fail-closed, no rompe)", async () => {
  assert.equal(
    await isFlagEnabled(fakeClient({ data: null, error: null }), "no_existe"),
    false
  );
});

test("error de base de datos => false SIN lanzar excepción (el resto del sistema sigue)", async () => {
  assert.equal(
    await isFlagEnabled(fakeClient({ data: null, error: { message: "boom" } }), "x"),
    false
  );
});

test("excepción de red => false SIN propagar (el resto del sistema sigue)", async () => {
  await assert.doesNotReject(async () => {
    const v = await isFlagEnabled(fakeClient({ data: null, error: null, throws: true }), "x");
    assert.equal(v, false);
  });
});

test("activo null (dato corrupto) => false", async () => {
  assert.equal(
    await isFlagEnabled(fakeClient({ data: { activo: null }, error: null }), "x"),
    false
  );
});
