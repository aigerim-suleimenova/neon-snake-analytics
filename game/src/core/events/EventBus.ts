export type EventListener<Payload> = (payload: Payload) => void;

export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<EventListener<Events[keyof Events]>>>();

  on<EventName extends keyof Events>(eventName: EventName, listener: EventListener<Events[EventName]>): () => void {
    const existingListeners = this.listeners.get(eventName) as Set<EventListener<Events[EventName]>> | undefined;
    const eventListeners = existingListeners ?? new Set<EventListener<Events[EventName]>>();
    eventListeners.add(listener);
    this.listeners.set(eventName, eventListeners as Set<EventListener<Events[keyof Events]>>);

    return () => {
      eventListeners.delete(listener);
      if (eventListeners.size === 0) this.listeners.delete(eventName);
    };
  }

  emit<EventName extends keyof Events>(eventName: EventName, payload: Events[EventName]): void {
    const eventListeners = this.listeners.get(eventName) as Set<EventListener<Events[EventName]>> | undefined;
    eventListeners?.forEach((listener) => listener(payload));
  }

  clear(): void {
    this.listeners.clear();
  }
}
