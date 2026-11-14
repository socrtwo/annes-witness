// The data model of a case. See docs/ARCHITECTURE-PLAN.md.
export type Id = string;

export type SourceRole = 'source' | 'document';
export type SourceKind =
  | 'pdf' | 'image' | 'text' | 'document' | 'workbook' | 'web' | 'recording' | 'email'
  | 'testimony' | 'reference' | 'presentation' | 'database' | 'gedcom' | 'report' | 'ebook' | 'other';
export type Classification = 'original' | 'derivative' | 'authored' | 'unknown';
export type Knowledge = 'first-hand' | 'second-hand' | 'unknown';
export type DerivationHow = 'copy' | 'index' | 'abstract' | 'translation' | 'transcription' | 'quotation' | 'other';

/** A run of a source's extracted text and where it sits in the original file. */
export interface Segment {
  start: number;
  end: number;
  label: string; // "p. 3", "Sheet1!B4", "¶ 12", "00:01:12"
  page?: number;
  sheet?: string;
  cell?: string;
  row?: number;
  col?: number;
  timeStart?: number;
  timeEnd?: number;
}

export interface CitationFields {
  type?: 'book' | 'article' | 'chapter' | 'web' | 'record' | 'interview' | 'letter' | 'report' | 'dataset' | 'other';
  authors?: string[];
  title?: string;
  container?: string; // journal, book, web site, collection
  publisher?: string;
  place?: string;
  year?: string;
  date?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
  doi?: string;
  isbn?: string;
  accessed?: string;
  repository?: string;
  callNumber?: string;
  note?: string;
}

export interface Source {
  id: Id;
  role: SourceRole;
  title: string;
  kind: SourceKind;
  mime?: string;
  fileName?: string;
  /** SHA-256 of the file's bytes (hex). */
  fileHash?: string;
  /** SHA-256 of the extracted text (hex). */
  contentHash?: string;
  /** True when the file's bytes are stored inside the case. */
  embedded: boolean;
  size?: number;
  added: string;
  citation: CitationFields;
  dateMade?: string;
  place?: string;
  obtained?: string;
  classification: Classification;
  derivedFrom: { sourceId: Id; how: DerivationHow }[];
  reliability?: string;
  confidential: boolean;
  group?: string;
  tags: string[];
  siglum?: string;
  key?: boolean;
  /** Extracted text: the coordinate space for text anchors. */
  text: string;
  segments: Segment[];
  pageCount?: number;
  ocr?: boolean;
  /** A person's transcription, line by line, kept beside the source. */
  transcription?: string;
  transcriptionStatus?: 'none' | 'started' | 'done' | 'reviewed';
  aiTranscription?: string;
  translationNotes?: { start: number; end: number; text: string; ai?: boolean }[];
  url?: string;
  capturedAt?: string;
  notes?: string;
  /** For testimony: who was present, consent to record. */
  testimony?: { informant: string; heardBy: string; when: string; present?: string; consent?: boolean };
  /** For a linked document: last time it was refreshed. */
  refreshedAt?: string;
  meta?: Record<string, string>;
}

export interface Rect { page: number; x: number; y: number; w: number; h: number } // fractions of the page

export interface Anchor {
  id: Id;
  sourceId: Id;
  start: number;
  end: number;
  exact: string;
  prefix: string;
  suffix: string;
  rect?: Rect;
  timeStart?: number;
  timeEnd?: number;
  informant?: string;
  knowledge: Knowledge;
  note?: string;
  broken?: boolean;
  /** Content hash of the source when the anchor was made. */
  sourceHash?: string;
  created: string;
}

export type ClaimKind = 'fact' | 'number' | 'date' | 'identity' | 'relationship' | 'quotation' | 'opinion' | 'other';

export interface DocRef {
  documentId: Id;
  start: number;
  end: number;
  textAtCapture: string;
}

export interface Claim {
  id: Id;
  number: number;
  text: string;
  kind: ClaimKind;
  importance: 'low' | 'normal' | 'high';
  owner?: string;
  due?: string;
  doc?: DocRef;
  dependsOn: Id[];
  group?: string;
  tags: string[];
  setAside?: { reason: string; by: string; at: string };
  flagged?: boolean;
  notes?: string;
  /** An editorial label a person chooses (for example a fact-check rating). Never computed. */
  verdict?: string;
  /** The sentence claim this atomic fact was split from. */
  parentId?: Id;
  /** Quoted speaker or work, for quotation claims. */
  attributedTo?: string;
  created: string;
}

export type TieKind = 'supports' | 'contradicts' | 'mentions' | 'absence' | 'sum-of' | 'claim';
export type TieState = 'proposed' | 'confirmed' | 'rejected';
export type Confidence = 'very-low' | 'low' | 'normal' | 'high' | 'very-high';

export interface Proposer {
  type: 'person' | 'auto' | 'ai';
  who: string;
  service?: string;
  model?: string;
  command?: string;
}

export interface Tie {
  id: Id;
  claimId: Id;
  anchorId?: Id;
  /** kind 'claim': this claim rests on another claim. */
  targetClaimId?: Id;
  /** kind 'sum-of': the claim equals the sum of these claims' figures. */
  partClaimIds?: Id[];
  kind: TieKind;
  /** For an absence tie: whether it counts for or against the claim. */
  absenceCounts?: 'for' | 'against' | 'neither';
  absenceSearch?: string;
  directness: 'direct' | 'indirect';
  tick?: string;
  confidence?: Confidence;
  state: TieState;
  proposedBy: Proposer;
  /** For AI proposals: the model's reason, shown as a note, never as evidence. */
  rationale?: string;
  confirmedBy?: string;
  confirmedAt?: string;
  claimTextAtConfirm?: string;
  sourceHashAtConfirm?: string;
  note?: string;
  created: string;
}

export interface ReckoningRow {
  sourceId: Id;
  anchorId?: Id;
  says: string;
  informant: string;
  knowledge: Knowledge;
  when: string;
  classification: Classification;
}

export interface Reckoning {
  id: Id;
  claimId: Id;
  rows: ReckoningRow[];
  preferredAnchorId?: Id;
  preferReason?: string;
  conclusion?: string;
  unresolved?: string;
  author?: string;
  date?: string;
  history: { conclusion?: string; preferredAnchorId?: Id; date: string; reopenedBecause?: string }[];
}

export interface LogEntry {
  id: Id;
  date: string;
  searched: string;
  where: string;
  forWhat: string;
  result: 'found' | 'not-found' | 'partial';
  claimId?: Id;
  sourceId?: Id;
  note?: string;
  kind?: 'search' | 'correspondence';
}

export interface Todo { id: Id; text: string; claimId?: Id; done: boolean; created: string; ai?: boolean }

export interface CaseComment {
  id: Id;
  target: { type: 'claim' | 'tie' | 'anchor' | 'source'; id: Id };
  text: string;
  author: string;
  created: string;
  resolved: boolean;
  replies: { author: string; text: string; created: string }[];
}

export interface SignOff {
  id: Id;
  claimId: Id;
  kind: 'prepared' | 'reviewed';
  by: string;
  at: string;
  /** Journal sequence number at sign-off; later changes to the claim clear a review. */
  seq: number;
}

export interface Rule {
  id: Id;
  name: string;
  /** Regular expression matched against the claim text (case-insensitive). */
  pattern: string;
  condition: 'minSupports' | 'minIndependent' | 'requiresTick' | 'requiresFirstHand' | 'numberAbove';
  value: number;
  message: string;
  enabled: boolean;
}

export interface AiHistoryEntry {
  id: Id;
  at: string;
  command: string;
  service: string;
  model: string;
  sent: string;
  sentChars: number;
  received: string;
  proposals: number;
  discarded: number;
}

export interface TickMark { mark: string; meaning: string }

export interface CaseSettings {
  title: string;
  question: string;
  author: string;
  standard: string;
  template: string;
  citationStyle: 'author-date' | 'notes';
  /** Allowed absolute difference when comparing numbers, after rounding to the claim's precision. */
  numberTolerance: number;
  /** Differences at or below this amount are reported as trivial (audit materiality). */
  materiality?: number;
  aiPrivacy: 'passages' | 'pages' | 'documents';
  checkOnSave: boolean;
  tickLegend: TickMark[];
  calendarDefault: 'gregorian' | 'julian';
  /** Years after which a source is old for claims about the present. */
  recencyYears: number;
  statusPatterns: boolean;
  /** Language of the case's text: spelling dictionary (en-US, en-GB, en-CA, en-AU) and OCR language (Tesseract code). */
  language?: { spell: string; ocr: string };
  /** A CSL style (XML) chosen with Report ▸ Citation Style; overrides citationStyle when set. */
  cslStyle?: string;
  /** Words added to the case's own spelling dictionary. */
  dictionary?: string[];
}

export interface SavedView { id: Id; name: string; filter: Record<string, string> }

export interface CaseData {
  format: 'annes-witness';
  version: 1;
  id: Id;
  created: string;
  settings: CaseSettings;
  sources: Record<Id, Source>;
  anchors: Record<Id, Anchor>;
  claims: Record<Id, Claim>;
  ties: Record<Id, Tie>;
  reckonings: Record<Id, Reckoning>;
  log: Record<Id, LogEntry>;
  todos: Record<Id, Todo>;
  comments: Record<Id, CaseComment>;
  signoffs: Record<Id, SignOff>;
  rules: Record<Id, Rule>;
  aiHistory: Record<Id, AiHistoryEntry>;
  views: Record<Id, SavedView>;
}

export type TableName =
  | 'sources' | 'anchors' | 'claims' | 'ties' | 'reckonings' | 'log' | 'todos' | 'comments'
  | 'signoffs' | 'rules' | 'aiHistory' | 'views';

export const TABLES: TableName[] = [
  'sources', 'anchors', 'claims', 'ties', 'reckonings', 'log', 'todos', 'comments', 'signoffs', 'rules', 'aiHistory', 'views',
];

export type Status = 'open' | 'supported' | 'corroborated' | 'disputed' | 'settled' | 'stale' | 'set-aside';

export const STATUS_LABEL: Record<Status, string> = {
  open: 'Open',
  supported: 'Supported',
  corroborated: 'Corroborated',
  disputed: 'Disputed',
  settled: 'Settled',
  stale: 'Stale',
  'set-aside': 'Set Aside',
};

export function defaultSettings(): CaseSettings {
  return {
    title: 'Untitled case',
    question: '',
    author: '',
    standard: '',
    template: 'blank',
    citationStyle: 'author-date',
    numberTolerance: 0,
    aiPrivacy: 'passages',
    checkOnSave: true,
    tickLegend: [
      { mark: '✓', meaning: 'Agreed to source' },
      { mark: 'Σ', meaning: 'Footed (total recomputed)' },
      { mark: '⇄', meaning: 'Cross-footed' },
      { mark: '≈', meaning: 'Recomputed within tolerance' },
    ],
    calendarDefault: 'gregorian',
    recencyYears: 5,
    statusPatterns: true,
  };
}
