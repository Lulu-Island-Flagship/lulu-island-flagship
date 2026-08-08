// Backward-compat barrel: re-exports everything from the pricing/ module.
// All original symbols are preserved; this file exists so that existing
// imports from "@/lib/pricing" continue to work without changes.
export * from "./pricing/index";
