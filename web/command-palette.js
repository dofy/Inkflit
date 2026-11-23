// Match every word in order-independent command labels, groups and aliases.
export function filterCommands(commands, query) {
  const terms=query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if(!terms.length)return commands;
  return commands.filter(command=>{
    const haystack=[command.label,command.group,command.shortcut,...(command.aliases||[])].filter(Boolean).join(' ').toLocaleLowerCase();
    return terms.every(term=>haystack.includes(term));
  });
}

// History is newest first. The latest available command wins, then frequency
// and recency. Unused commands stay in their default order.
export function rankCommands(commands, history) {
  const available = new Set(commands.map(command => command.id));
  const usage = new Map();
  for (const id of history) {
    if (!available.has(id)) continue;
    const stats = usage.get(id);
    if (stats) stats.count++;
    else usage.set(id, { count: 1, recency: usage.size });
  }
  const latest = usage.keys().next().value;
  return [...commands].sort((a, b) => {
    const first = usage.get(a.id), second = usage.get(b.id);
    return Number(b.id === latest) - Number(a.id === latest)
      || (second?.count ?? 0) - (first?.count ?? 0)
      || (first?.recency ?? history.length) - (second?.recency ?? history.length);
  });
}
