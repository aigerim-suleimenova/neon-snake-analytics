interface Group<Item> {
  items: Item[];
  settle: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
}

/**
 * Turns `flush` into a function many callers can use at once, where only one flush runs at a time and the
 * items added meanwhile go out together in the next one: a group commit. With no flush running, items go out
 * at once, so a quiet system waits for nothing; under load, each flush carries everything that arrived during
 * the previous one, so throughput grows with the load instead of being one round trip per caller.
 *
 * Each caller's promise settles with the flush that carried its items. A group holds at most `maxItems`
 * (one call's items are never split); more start the next group.
 */
export function groupCommit<Item>(flush: (items: Item[]) => Promise<void>, maxItems: number): (items: readonly Item[]) => Promise<void> {
  const groups: Group<Item>[] = [];
  let flushing = false;

  const drain = async () => {
    flushing = true;
    while (groups.length > 0) {
      const group = groups.shift() as Group<Item>;
      try {
        await flush(group.items);
        group.settle.forEach(({ resolve }) => resolve());
      } catch (error) {
        group.settle.forEach(({ reject }) => reject(error));
      }
    }
    flushing = false;
  };

  return (items) =>
    new Promise<void>((resolve, reject) => {
      const last = groups.at(-1);
      const group = last && last.items.length + items.length <= maxItems ? last : { items: [], settle: [] };
      if (group !== last) groups.push(group);
      group.items.push(...items);
      group.settle.push({ resolve, reject });
      if (!flushing) void drain();
    });
}
