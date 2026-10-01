export type Tier = 'BRONZE' | 'SILVER' | 'GOLD';
export type Status = 'Placed' | 'PendingApproval' | 'Confirmed' | 'Rejected' | 'Dispatched' | 'Delivered' | 'Cancelled';
export interface Actor { id: string; name: string; role: 'DISTRIBUTOR' | 'SALES_MANAGER'; distributor: { id: string; tier: Tier; creditLimitMinor: number } | null }
export interface Product { id: string; sku: string; name: string; unitPriceMinor: number; availableStock: number }
export interface Profile { id: string; points: number; tier: Tier; creditLimitMinor: number; availableCreditMinor: number }
export interface OrderItem { id: string; productId: string; quantity: number; unitPriceMinor: number; lineSubtotalMinor: number; product?: { sku: string; name: string } }
export interface OrderEvent { id: string; fromStatus: Status; toStatus: Status; actorType: 'USER' | 'SYSTEM'; actorUserId: string | null; createdAt: string }
export interface Order { id: string; distributorId: string; status: Status; subtotalMinor: number; discountPercent: number; discountMinor: number; totalMinor: number; createdAt: string; items: OrderItem[]; events?: OrderEvent[]; loyalty?: { points: number; tier: Tier } }
export type Action = 'approve' | 'reject' | 'cancel' | 'dispatch' | 'deliver';
