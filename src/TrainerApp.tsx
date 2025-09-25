import React, { useMemo, useState, useCallback, useEffect } from "react";

/**
 * Short-Form Truth-Table Trainer — Starter Implementation (React + TypeScript)
 *
 * Changes in this version:
 * - Column headers show ONLY the symbol (atom or connective). No sublabels.
 * - Parentheses are displayed in the top formula (as tokens) and highlighting spans the WHOLE subformula.
 */

// =============== Types ===============

type TokType = "LPAREN" | "RPAREN" | "NOT" | "AND" | "OR" | "IMP" | "IFF" | "VAR";

interface Token {
  type: TokType;
  text: string; // exact text as in the source string
  idx: number;  // position in token array
  start: number; // char index in source
  end: number;   // char index (exclusive)
}

type NodeId = string;

type ASTVar = {
  kind: "Var";
  id: NodeId;
  name: string;
  spanStartTok: number;
  spanEndTok: number;
  mainTok: number; // token index where this occurrence sits
};

type ASTNot = {
  kind: "Not";
  id: NodeId;
  child: AST;
  spanStartTok: number; // index of '~'
  spanEndTok: number;   // index of closing token of child (or same for Var)
  mainTok: number;      // token index for '~'
};

type BinOp = "And" | "Or" | "Imp" | "Iff";

type ASTBin = {
  kind: "Bin";
  id: NodeId;
  op: BinOp;
  left: AST;
  right: AST;
  spanStartTok: number; // usually '('
  spanEndTok: number;   // ')'
  mainTok: number;      // token index of the operator symbol
};

type AST = ASTVar | ASTNot | ASTBin;

// Columns for the table

type ColumnId = string; // node ids for connective; "occ:{nodeId}" for var occurrence; "val:{atom}" for valuation

type ColValuation = { kind: "Valuation"; id: ColumnId; atom: string };

type ColOccurrence = { kind: "Occurrence"; id: ColumnId; atom: string; nodeId: NodeId; mainTok: number };

type ColConnective = { kind: "Connective"; id: ColumnId; nodeId: NodeId; mainTok: number; deps: ColumnId[] };

type Column = ColValuation | ColOccurrence | ColConnective;

type TF = "T" | "F" | "";

type Row = Record<ColumnId, TF>;

type Difficulty = "Easy" | "Medium" | "Hard";



// =============== Utilities ===============

function isAlpha(ch: string) { return /[A-Z]/.test(ch); }
function idGen() { let n = 0; return () => `n${++n}`; }

// =============== Tokenizer ===============

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0; let t = 0;
  const push = (type: TokType, text: string, start: number, end: number) => { tokens.push({ type, text, idx: t++, start, end }); };
  while (i < src.length) {
    const ch = src[i];
    if (ch === " ") { i++; continue; }
    if (ch === "(") { push("LPAREN", ch, i, i+1); i++; continue; }
    if (ch === ")") { push("RPAREN", ch, i, i+1); i++; continue; }
    if (ch === "~" || ch === "¬") { push("NOT", ch, i, i+1); i++; continue; }
    if (ch === "&" || ch === "∧") { push("AND", ch, i, i+1); i++; continue; }
    if (ch === "v" || ch === "∨") { push("OR", ch, i, i+1); i++; continue; }
    if (ch === "-") { if (src.slice(i, i+2) === "->") { push("IMP", "->", i, i+2); i += 2; continue; } }
    if (ch === "<") { if (src.slice(i, i+3) === "<->") { push("IFF", "<->", i, i+3); i += 3; continue; } }
    if (isAlpha(ch)) { push("VAR", ch, i, i+1); i++; continue; }
    // skip unknown
    i++;
  }
  return tokens;
}

// =============== Parser (expects full parentheses) ===============

class ParseError extends Error {}

function parseFormula(src: string) {
  const tokens = tokenize(src);
  const nextId = idGen();
  let p = 0;
  const peek = () => tokens[p];
  const consume = (type?: TokType) => {
    const tk = tokens[p];
    if (!tk) throw new ParseError("Unexpected end of input");
    if (type && tk.type !== type) throw new ParseError(`Expected ${type} at token ${p}, got ${tk.type}`);
    p++; return tk;
  };
  function parsePrimary(): AST {
    const tk = peek(); if (!tk) throw new ParseError("Unexpected end");
    if (tk.type === "VAR") {
      const varTok = consume("VAR");
      const node: ASTVar = { kind: "Var", id: nextId(), name: varTok.text, spanStartTok: varTok.idx, spanEndTok: varTok.idx, mainTok: varTok.idx };
      return node;
    }
    if (tk.type === "NOT") {
      const notTok = consume("NOT");
      const child = parsePrimary();
      const node: ASTNot = { kind: "Not", id: nextId(), child, spanStartTok: notTok.idx, spanEndTok: child.spanEndTok, mainTok: notTok.idx };
      return node;
    }
    if (tk.type === "LPAREN") {
      const lp = consume("LPAREN");
      const left = parsePrimary();
      const opTok = consume();
      if (!(opTok.type === "AND" || opTok.type === "OR" || opTok.type === "IMP" || opTok.type === "IFF")) {
        throw new ParseError(`Expected binary connective after '(', got ${opTok.type}`);
      }
      const right = parsePrimary();
      const rp = consume("RPAREN");
      const node: ASTBin = {
        kind: "Bin", id: nextId(), op: opTok.type === "AND" ? "And" : opTok.type === "OR" ? "Or" : opTok.type === "IMP" ? "Imp" : "Iff",
        left, right, spanStartTok: lp.idx, spanEndTok: rp.idx, mainTok: opTok.idx
      };
      return node;
    }
    throw new ParseError(`Unexpected token ${tk.type}`);
  }
  const ast = parsePrimary();
  if (p !== tokens.length) throw new ParseError("Extra tokens after parse");
  return { ast, tokens };
}

// =============== Pretty printer ===============

function printAST(ast: AST): string {
  switch (ast.kind) {
    case "Var": return ast.name;
    case "Not": return `~${wrapIfNeeded(ast.child)}`;
    case "Bin": {
      const op = ast.op === "And" ? "&" : ast.op === "Or" ? "v" : ast.op === "Imp" ? "->" : "<->";
      return `(${printAST(ast.left)} ${op} ${printAST(ast.right)})`;
    }
  }
}
function wrapIfNeeded(a: AST): string { return a.kind === "Var" ? a.name : printAST(a); }

// =============== Collect atoms and valuations ===============

function collectAtoms(ast: AST, set = new Set<string>()) {
  if (ast.kind === "Var") set.add(ast.name);
  else if (ast.kind === "Not") collectAtoms(ast.child, set);
  else { collectAtoms(ast.left, set); collectAtoms(ast.right, set); }
  return [...set].sort();
}

function makeValuations(atoms: string[]): Array<Record<string, TF>> {
  const n = atoms.length; 
  const rows: Array<Record<string, TF>> = []; const total = 1 << n;
  for (let i = total - 1; i >= 0; i--) {
    const row: Record<string, TF> = {};
    for (let j = 0; j < n; j++) {
      const bit = (i >> (n - j - 1)) & 1; // leftmost flips slowest
      row[atoms[j]] = bit ? "T" : "F";
    }
    rows.push(row);
  }
  return rows;
}


// =============== Evaluation ===============

function evalNode(ast: AST, assign: (atom: string) => TF): TF {
  switch (ast.kind) {
    case "Var": return assign(ast.name);
    case "Not": {
      const v = evalNode(ast.child, assign); if (v === "") return ""; return v === "T" ? "F" : "T";
    }
    case "Bin": {
      const L = evalNode(ast.left, assign); const R = evalNode(ast.right, assign); if (L === "" || R === "") return "";
      if (ast.op === "And") return L === "T" && R === "T" ? "T" : "F";
      if (ast.op === "Or")  return L === "T" || R === "T" ? "T" : "F";
      if (ast.op === "Imp") return L === "T" && R === "F" ? "F" : "T";
      return L === R ? "T" : "F"; // Iff
    }
  }
}

// =============== Column planning ===============

interface Plan { columns: Column[]; tokToColumnId: Map<number, ColumnId>; }

function planColumns(ast: AST, tokens: Token[], atoms: string[]): Plan {
  const columns: Column[] = [];
  const tokToColumnId = new Map<number, ColumnId>();

  // Valuation columns (left block)
  for (const a of atoms) columns.push({ kind: "Valuation", id: `val:${a}`, atom: a });

  // Map mainTok -> node
  const mainTokToNode = new Map<number, AST>();
  (function walk(n: AST) { mainTokToNode.set(n.mainTok, n); if (n.kind === "Not") walk(n.child); else if (n.kind === "Bin") { walk(n.left); walk(n.right); } })(ast);

  // Token pass → build occurrence + connective columns left-to-right
  for (const tk of tokens) {
    if (tk.type === "VAR") {
      const node = mainTokToNode.get(tk.idx);
      if (node && node.kind === "Var") {
        const id: ColumnId = `occ:${node.id}`;
        columns.push({ kind: "Occurrence", id, atom: node.name, nodeId: node.id, mainTok: node.mainTok });
        tokToColumnId.set(tk.idx, id);
      }
    } else if (tk.type === "NOT" || tk.type === "AND" || tk.type === "OR" || tk.type === "IMP" || tk.type === "IFF") {
      const node = mainTokToNode.get(tk.idx);
      if (node) {
        const id: ColumnId = node.id; // connective column id == nodeId
        columns.push({ kind: "Connective", id, nodeId: node.id, mainTok: node.mainTok, deps: [] });
        tokToColumnId.set(tk.idx, id);
      }
    }
  }

  // Resolve deps using child mainTok mapping
  for (const col of columns) {
    if (col.kind !== "Connective") continue;
    const node = findNode(ast, col.nodeId);
    if (!node) continue;
    if (node.kind === "Not") {
      const dep = tokToColumnId.get(node.child.mainTok);
      if (dep) col.deps = [dep];
    } else if (node.kind === "Bin") {
      const l = tokToColumnId.get(node.left.mainTok);
      const r = tokToColumnId.get(node.right.mainTok);
      col.deps = [l, r].filter(Boolean) as ColumnId[];
    }
  }

  return { columns, tokToColumnId };
}

// =============== Random formula generator ===============

function countConnectives(ast: AST): { nots: number; bins: number; total: number } {
  if (ast.kind === "Var") return { nots: 0, bins: 0, total: 0 };
  if (ast.kind === "Not") {
    const c = countConnectives(ast.child);
    const nots = c.nots + 1;
    return { nots, bins: c.bins, total: nots + c.bins };
  }
  // Bin
  const L = countConnectives(ast.left);
  const R = countConnectives(ast.right);
  const bins = L.bins + R.bins + 1;
  const nots = L.nots + R.nots;
  return { nots, bins, total: nots + bins };
}

function randomFormula(opts: { diff: Difficulty; maxAtoms?: number; seed?: number; minConnectives?: number }) {
  const rng = mulberry32(opts.seed ?? (Date.now() & 0xfffffff));
  const minConn = opts.minConnectives ?? 2;

  // Atom pool
  const atomsPool = ["P", "Q", "R", "S"];
  const maxAtoms = opts.maxAtoms ?? 3;
  const pool = atomsPool.slice(0, maxAtoms);

  const ops: BinOp[] = ["And", "Or", "Imp", "Iff"];
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];

  // Keep depth very shallow → small formulas
  const targetDepth = 2;
  const negChance = 0.4;

  function gen(depth: number): AST {
    // base case: leaf variable
    if (depth <= 0 || rng() < 0.4) {
      const name = pick(pool);
      return { kind: "Var", id: "tmp", name, spanStartTok: -1, spanEndTok: -1, mainTok: -1 } as ASTVar;
    }

    // maybe negation
    if (rng() < negChance) {
      const child = gen(depth - 1);
      return { kind: "Not", id: "tmp", child, spanStartTok: -1, spanEndTok: -1, mainTok: -1 } as ASTNot;
    }

    // binary connective
    const left = gen(depth - 1);
    const right = gen(rng() < 0.7 ? depth - 1 : 0);  // often one side simple
    const op = pick(ops);
    return { kind: "Bin", id: "tmp", op, left, right, spanStartTok: -1, spanEndTok: -1, mainTok: -1 } as ASTBin;
  }

  function reprintAndReparse(tempAst: AST) {
    const src = printAST(tempAst);
    const { ast, tokens } = parseFormula(src);
    return { src, ast, tokens };
  }

  // --- rejection sampling loop ---
  let best: { src: string; ast: AST; tokens: Token[] } | null = null as any;
  for (let tries = 0; tries < 12; tries++) {
    const draft = gen(targetDepth);
    const out = reprintAndReparse(draft);
    const c = countConnectives(out.ast);
    if (c.total >= minConn) return out;  // success!

    // keep the “most connective” one as best fallback
    if (!best) best = out as any;
    else {
      const bc = countConnectives(best.ast);
      if (c.total > bc.total) best = out as any;
    }
  }
  // If we get here, RNG was unlucky—return the best we saw
  return best!;
}



function mulberry32(a: number) { return function() { let t = (a += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// =============== UI Components ===============

const Cell: React.FC<{ value: TF; onClick?: () => void; locked?: boolean; isWrong?: boolean; }> = ({ value, onClick, locked, isWrong }) => (
  <button
    onClick={onClick}
   
    className={["w-10 h-8 border text-sm font-mono flex items-center justify-center", locked ? "bg-gray-100" : "bg-white", isWrong ? "ring-2 ring-red-500" : "", locked ? "cursor-default" : "hover:bg-gray-50"].join(" ")}
    aria-label={locked ? `Cell ${value} locked` : `Cell ${value || "blank"}`}
  >
    {value}
  </button>
);

const ColumnHeader: React.FC<{ label: string; active?: boolean; locked?: boolean; onClick?: () => void; }> = ({ label, active, locked, onClick }) => (
  <div className={["flex flex-col items-center gap-0.5 px-2", active ? "outline outline-2 outline-blue-500 rounded" : ""].join(" ")}>
    <button onClick={onClick} className="text-base font-mono leading-none py-0.5" aria-pressed={active}>{label}</button>
  
  </div>
);

const MessageBar: React.FC<{ kind: "ok" | "error" | null; text: string }> = ({ kind, text }) => {
  if (!kind) return null;
  return (
    <div className={["mt-2 px-3 py-2 rounded text-sm", kind === "ok" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-rose-50 text-rose-800 border border-rose-200"].join(" ")} aria-live="polite">{text}</div>
  );
};

// =============== Hook ===============

function useTrainer(initialDifficulty: Difficulty = "Easy") {
  const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
  const [seed, setSeed] = useState<number>(() => Math.floor(Math.random() * 1e9));
  const [src, setSrc] = useState<string>("~(P v Q)");
  const [ast, setAst] = useState<AST | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [locked, setLocked] = useState<Set<ColumnId>>(new Set());
  const [focus, setFocus] = useState<ColumnId | null>(null);
  const [wrongMap, setWrongMap] = useState<Record<string, boolean[]>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error" | null; text: string }>({ kind: null, text: "" });
  const [tokMap, setTokMap] = useState<Map<number, ColumnId>>(new Map());

    // Track which columns have already shown the instruction message (so we don’t spam)
  const [instructedCols, setInstructedCols] = useState<Set<ColumnId>>(new Set());

  // Helpers to show messages
  const showError = useCallback((text: string) => {
    setMessage({ kind: "error", text });
  }, []);

  const showInstruction = useCallback(() => {
  setMessage({
    kind: "ok",
    text:
      "Fill this column by entering T/F for the highlighted sentence (the subformula whose main connective is above this column). When you’re done, click “Check column”."
  });
}, []);

  const atoms = useMemo(() => (ast ? collectAtoms(ast) : []), [ast]);
  const valuations = useMemo(() => makeValuations(atoms), [atoms]);

  const replan = useCallback((srcString: string) => {
    try {
      const { ast, tokens } = parseFormula(srcString);
      setAst(ast); setTokens(tokens);
      const { columns, tokToColumnId } = planColumns(ast, tokens, collectAtoms(ast));
      const atomNames = collectAtoms(ast);
      const vals = makeValuations(atomNames);
      const table: Row[] = vals.map(v => {
        const r: Row = {} as Row;
        for (const a of atomNames) r[`val:${a}`] = v[a]; // valuation
        for (const col of columns) { // prefill occurrences
          if (col.kind === "Occurrence") r[col.id] = v[col.atom];
          else if (col.kind === "Connective") r[col.id] = "";
        }
        return r;
      });
      setColumns(columns);
      const firstConn = columns.find(c => c.kind === "Connective");
      setFocus(firstConn ? firstConn.id : null);
      setTokMap(tokToColumnId);
      setRows(table);
      setLocked(new Set(columns.filter(c => c.kind !== "Connective").map(c => c.id)));
      setFocus(null); setWrongMap({}); setMessage({ kind: null, text: "" });
    } catch (e: any) {
      setMessage({ kind: "error", text: `Parse error: ${e.message}` });
    }
  }, []);

  useEffect(() => { replan(src); }, []);

  const regenerate = useCallback(() => {
    const { src: s } = randomFormula({ diff: difficulty, seed });
    setSrc(s); replan(s); setSeed(x => (x + 1) >>> 0);
  }, [difficulty, seed, replan]);

  const colById = useCallback((id: ColumnId) => columns.find(c => c.id === id), [columns]);

 const isEligible = useCallback((id: ColumnId) => {
  const col = colById(id);
  if (!col || col.kind !== "Connective") return false;

  for (const dep of col.deps) {
    for (const r of rows) {
      const v = r[dep] as TF;     // "T" | "F" | ""
      if (v === "") return false; // only blocked when blank
    }
  }
  return true;
}, [rows, colById]);

  const setCell = useCallback((rowIdx: number, colId: ColumnId) => {
    setRows(prev => { const copy = prev.map(r => ({ ...r })); const v = copy[rowIdx][colId]; copy[rowIdx][colId] = v === "" ? "T" : v === "T" ? "F" : ""; return copy; });
  }, []);

  const checkColumn = useCallback((colId: ColumnId) => {
    const col = colById(colId); if (!col) return;
    if (col.kind !== "Connective") { setMessage({ kind: "error", text: "Please select a connective column to check." }); return; }
    if (!isEligible(colId)) { setFocus(colId); setMessage({ kind: "error", text: "You can’t fill this yet—finish the highlighted subformula’s columns first." }); return; }
    if (!ast) return;

    const correct: TF[] = rows.map((_, i) => {
      const assign = (a: string) => rows[i][`val:${a}`] as TF;
      const node = findNode(ast, col.nodeId)!;
      return evalNode(node, assign);
    });

    const wrong: boolean[] = []; let anyWrong = false;
    for (let i = 0; i < rows.length; i++) { const got = rows[i][colId]; const ok = got === correct[i]; wrong[i] = !ok; if (!ok) anyWrong = true; }

    if (anyWrong) { setWrongMap(prev => ({ ...prev, [colId]: wrong })); setMessage({ kind: "error", text: "There are mistakes in this column." }); }
    else { setWrongMap(prev => ({ ...prev, [colId]: rows.map(() => false) })); setLocked(prev => new Set([...prev, colId])); setMessage({ kind: "ok", text: "Correct — column filled." }); }
  }, [rows, columns, ast, colById, isEligible]);

  return {
    state: { difficulty, src, ast, tokens, columns, rows, locked, focus, wrongMap, message, tokMap },
    actions: {
      setDifficulty,
      setSrc: (s: string) => { setSrc(s); replan(s); },
      regenerate,
      setFocus,
      setCell,
      checkColumn,
      showError,
      showInstruction
    }
  } as const;
}

// =============== Top Formula (with parentheses + highlight) ===============

const TopFormula: React.FC<{ src: string; tokens: Token[]; ast: AST | null; focus: ColumnId | null; columns: Column[]; onClickToken?: (tokIdx: number) => void; }>
= ({ tokens, ast, focus, columns, onClickToken }) => {
  const focusSpan = useMemo(() => {
    if (!focus) return null;
    const col = columns.find(c => c.id === focus);
    if (!col) return null;
    const node = (function resolveNode(): AST | null {
      if (col.kind === "Connective") return findNode(ast, col.nodeId);
      if (col.kind === "Occurrence") return findNode(ast, col.nodeId);
      return null;
    })();
    if (!node) return null;
    return { startTok: node.spanStartTok, endTok: node.spanEndTok };
  }, [focus, columns, ast]);

  const tokenClass = (tok: Token) => {
  if (!focusSpan) return "";
  const inSpan = tok.idx >= focusSpan.startTok && tok.idx <= focusSpan.endTok;
  return inSpan ? "bg-yellow-200 " : "";
};

  return (
    <div className="font-mono text-lg flex flex-wrap items-center justify-center gap-x-1 gap-y-2">
      {tokens.map(tk => (
        <span key={tk.idx} className={["px-0.5", tokenClass(tk)].join(" ")}
          onClick={() => onClickToken && onClickToken(tk.idx)} role="button" aria-label={`token ${tk.text}`}>
          {tk.text}
        </span>
      ))}
    </div>
  );
};

// =============== Main App ===============

const TrainerApp: React.FC = () => {
  const { state, actions } = useTrainer("Medium");
  const { difficulty, src, tokens, columns, rows, locked, focus, wrongMap, message, ast, tokMap } = state;

const setFocusByTok = useCallback((tokIdx: number) => {
  const mappedId = tokMap.get(tokIdx); // reliable mapping made in planColumns
  if (!mappedId) return;               // parentheses etc. won't map — that's fine
  const col = columns.find(c => c.id === mappedId);
  if (col && col.kind !== "Valuation") actions.setFocus(col.id);
}, [tokMap, columns, actions]);


  const leftCols = columns.filter(c => c.kind === "Valuation"); // not used for headers but kept for future
  const rightCols = columns.filter(c => c.kind !== "Valuation");

  type DisplayCol =
  | { kind: "Val";   id: string;   label: string; width: "val" }
  | { kind: "Paren"; id: string;   label: "(" | ")"; width: "paren" }
  | { kind: "Data";  id: ColumnId; label: string; width: "char" };

const displayColumns = useMemo<DisplayCol[]>(() => {
  const list: DisplayCol[] = [];

  // 1) valuations first (left block)
  for (const c of columns) {
    if (c.kind === "Valuation") {
      list.push({ kind: "Val", id: c.id, label: c.atom, width: "val" });
    }
  }

  // 2) then one display item per token
  for (const tk of tokens) {
    if (tk.type === "LPAREN" || tk.type === "RPAREN") {
      list.push({ kind: "Paren", id: `paren:${tk.idx}`, label: tk.text as "(" | ")", width: "paren" });
      continue;
    }

    const mappedId = tokMap.get(tk.idx);
    if (!mappedId) continue;

    const col = columns.find(c => c.id === mappedId);
    if (!col) continue;

    let label: string;

    if (col.kind === "Occurrence") {
      label = col.atom;
    } else if (col.kind === "Connective") {
      const n = findNode(ast, col.nodeId);
      if (!n) {
        label = "?";
      } else if (n.kind === "Not") {
        label = "~";
      } else if (n.kind === "Bin") {
  label = n.op === "And" ? "∧"
        : n.op === "Or"  ? "∨"
        : n.op === "Imp" ? "→"
        :                  "↔";
}
       else {
        // (shouldn't happen for connective columns)
        label = "?";
      }
    } else {
      // Valuation won't appear here, but keep TypeScript happy
      continue;
    }

    list.push({ kind: "Data", id: col.id, label, width: "char" });
  }

  return list;
}, [columns, tokens, tokMap, ast]);


  const isLocked = (id: ColumnId) => locked.has(id);
  const activeColId = focus && rightCols.some(c => c.id === focus) ? focus : null;

const isEligibleLocal = (id: ColumnId) => {
  const col = columns.find(c => c.id === id);
  if (!col || col.kind !== "Connective") return false;

  for (const dep of col.deps) {
    for (const r of rows) {
      const v = r[dep] as TF;      // "T" | "F" | ""
      if (v === "") return false;  // blocked only when blank
    }
  }
  return true;
};


  const toggleCell = (r: number, c: ColumnId) => {
    const col = columns.find(x => x.id === c); if (!col) return;
    if (isLocked(c)) return; if (col.kind !== "Connective") return;
    if (!activeColId || activeColId !== c) actions.setFocus(c);
    actions.setCell(r, c);
  };

  const allConnectivesLocked = rightCols.filter(c => c.kind === "Connective").every(c => isLocked(c.id));

  return (
    
    <div className="p-4 max-w-full">
      <h1 className="text-2xl font-semibold mb-3">Short-Form Truth-Table Trainer</h1>



      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="text-sm">Difficulty:</label>
        <select className="border rounded px-2 py-1 text-sm" value={difficulty} onChange={(e) => actions.setDifficulty(e.target.value as Difficulty)}>
          <option>Easy</option><option>Medium</option><option>Hard</option>
        </select>
        <button className="border rounded px-3 py-1 text-sm" onClick={actions.regenerate}>New random</button>
        <span className="mx-2 text-gray-400">or</span>
        <input value={src} onChange={(e) => actions.setSrc(e.target.value)} className="border rounded px-2 py-1 text-sm w-[360px]" aria-label="Formula input" />
      </div>


      {/* Top formula */}
      <TopFormula src={src} tokens={tokens} ast={ast} focus={focus} columns={columns} onClickToken={setFocusByTok} />

      {/* Table */}
      <div className="mt-4 overflow-x-auto">
  <div
    className="mx-auto"
    style={{ display: "inline-grid", gridTemplateColumns: displayColumns
        .map(dc => dc.width === "val" ? "64px" : dc.width === "paren" ? "24px" : "56px")
        .join(" "),
    }}
  >
    {/* headers */}
    {displayColumns.map(dc => {
      const active = focus === dc.id;
      const lockedHeader =
        dc.kind === "Val" ? true :
        dc.kind === "Data" ? isLocked(dc.id) : false;

      return (
        <div key={"h:"+dc.id} className="px-1">
          {dc.kind === "Paren" ? (
            <div className="text-base font-mono leading-none py-0.5 text-slate-500 text-center">
              {dc.label}
            </div>
          ) : (
            <ColumnHeader
  label={dc.label}
  active={active}
  locked={lockedHeader}
  onClick={dc.kind === "Data"
    ? () => {
        actions.setFocus(dc.id);
        const col = columns.find(c => c.id === dc.id);
        // Show dependency error if they click a not-yet-eligible connective header
        if (col && col.kind === "Connective") {
          const eligible = isEligibleLocal(dc.id);
          if (!eligible) {
            actions.showError(
              "You can’t fill this column yet. First compute truth values for its subformulas (the columns that feed into this one)."
            );
          }
        }
      }
    : undefined}
/>
          )}
        </div>
      );
    })}

    {/* rows */}
    {rows.map((r, rIdx) =>
      displayColumns.map(dc => {
        if (dc.kind === "Paren") {
          return <div key={`r:${rIdx}:${dc.id}`} className="p-1"><div className="w-6 h-8" /></div>;
        }
        const val = r[dc.id] as TF;
        const wrong = !!wrongMap[dc.kind === "Data" ? dc.id : ""]?.[rIdx];

        const isStaticVal = dc.kind === "Val";
        const isInteractable =
          dc.kind === "Data" &&
          !isLocked(dc.id) &&
          isEligibleLocal(dc.id);

        return (
          <div key={`r:${rIdx}:${dc.id}`} className="p-1">
            {isStaticVal ? (
              <div className="w-10 h-8 border rounded font-mono text-sm flex items-center justify-center bg-gray-100 text-black">
                {val}
              </div>
            ) : (
              <Cell
  value={val}
  locked={!isInteractable}
  isWrong={wrong}
  onClick={() => {
    const col = columns.find(c => c.id === dc.id);
    // Only connective columns are student-fillable
    if (!col || col.kind !== "Connective") return;

    if (!isEligibleLocal(dc.id)) {
      actions.setFocus(dc.id);
      actions.showError(
        "You can’t fill this column yet. First compute truth values for its subformulas (the columns that feed into this one)."
      );
      return;
    }

    // Eligible: nudge once with instruction then proceed
    actions.setFocus(dc.id);
    actions.showInstruction();
    toggleCell(rIdx, dc.id);
  }}
/>

            )}
          </div>
        );
      })
    )}
  </div>
</div>


      {/* Actions for active column */}
      <div className="mt-3 flex items-center gap-2">
        <button className="border rounded px-3 py-1 text-sm" onClick={() => focus && actions.checkColumn(focus)} disabled={!focus || columns.find(c => c.id === focus)?.kind !== "Connective"}>Check column</button>
        {focus && columns.find(c => c.id === focus)?.kind === "Connective" && !isEligibleLocal(focus) && (<span className="text-xs text-rose-700">This column is gated until its subcolumns are finished.</span>)}
        {allConnectivesLocked && (<span className="text-sm text-emerald-700">✓ All columns complete!</span>)}
      </div>

      <MessageBar kind={message.kind} text={message.text} />

      <p className="text-xs text-gray-500 mt-4">Tip: Click a connective header to focus and highlight its whole subformula above. Cells toggle blank→T→F.</p>
    </div>
  );
};

// =============== Helpers & Export ===============

function findNode(ast: AST | null, id: string): AST | null {
  if (!ast) return null;
  if ((ast as any).id === id) return ast;
  if (ast.kind === "Not") return findNode(ast.child, id);
  if (ast.kind === "Bin") return findNode(ast.left, id) || findNode(ast.right, id);
  return null;
}

export default TrainerApp;

