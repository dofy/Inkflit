// Match every word in order-independent command labels, groups and aliases.
export function filterCommands(commands, query) {
  const terms=query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if(!terms.length)return commands;
  return commands.filter(command=>{
    const haystack=[command.label,command.group,command.shortcut,...(command.aliases||[])].filter(Boolean).join(' ').toLocaleLowerCase();
    return terms.every(term=>haystack.includes(term));
  });
}

// Take the newest occurrence of each available command, then keep the default
// order for commands without a history entry.
export function rankCommands(commands, history) {
  const remaining = new Map(commands.map(command => [command.id, command]));
  const recent = [];
  for (const id of history) {
    const command = remaining.get(id);
    if (!command) continue;
    recent.push(command);
    remaining.delete(id);
  }
  return [...recent, ...remaining.values()];
}
