import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Actor } from '../types/api';
const ActorContext = createContext<{ actor: Actor | null; selectActor: (actor: Actor) => void } | null>(null);
export function ActorProvider({ children }: { children: ReactNode }) {
  const [actor, selectActor] = useState<Actor | null>(null);
  return <ActorContext.Provider value={{ actor, selectActor }}>{children}</ActorContext.Provider>;
}
export function useActor() {
  const context = useContext(ActorContext);
  if (!context) throw new Error('ActorProvider is required');
  return context;
}
