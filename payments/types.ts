export const routes = ['/shop/products', '/shop/cart', '/shop/checkout'] as const;
export type Route = (typeof routes)[number];
export type Level = 'info' | 'error';
export const flagDefinitions = [
  { id: 'order_receipts', label: 'Order receipts', description: 'Include a receipt ID in checkout responses.' },
  { id: 'cart_item_details', label: 'Cart item details', description: 'Include the product and quantity in cart responses.' },
  { id: 'strict_payment_validation', label: 'Strict payment validation', description: 'Check the payment currency against the cart quote.' },
] as const;

type FlagDefinition = (typeof flagDefinitions)[number];
export type FlagId = FlagDefinition['id'];
export type FlagSource = 'human' | 'agent';

export interface FlagSnapshot {
  id: number;
  values: Readonly<Record<FlagId, boolean>>;
}

export interface FlagChange {
  id: number;
  flag: FlagId;
  enabled: boolean;
  previousEnabled: boolean;
  source: FlagSource;
  at: number;
}

export interface FlagLog {
  current: FlagSnapshot;
  definitions: readonly FlagDefinition[];
  history: FlagChange[];
}

export interface RequestError {
  code: string;
  message: string;
}

export interface RequestLog {
  sequence: number;
  at: number;
  level: Level;
  requestId: string;
  userId: string | null;
  flowId: string | null;
  method: string;
  route: Route;
  status: number;
  durationMs: number;
  flags: FlagSnapshot;
  error: RequestError | null;
  checkout?: { cartId: string; currency: string };
}

export interface LogFilters {
  level?: Level;
  userId?: string;
  requestId?: string;
  flowId?: string;
  flagSnapshotId?: number;
  route?: Route;
  limit?: number;
}

export type QueryLogs = LogFilters & { before?: number };
export type TailLogs = LogFilters & { after?: number };
export type FlagTarget = { flag: FlagId; expectedSnapshotId: number };
export type SetFlag = FlagTarget & { enabled: boolean };

export interface Health {
  start: number;
  end: number;
  bucketMs: number;
  buckets: Array<{ at: number } & Record<Level, number>>;
  totals: Record<Level, number>;
  markers: FlagChange[];
}

export interface Dashboard {
  health: Health;
  flags: FlagLog;
  logs: RequestLog[];
}
