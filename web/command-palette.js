// Match every word in order-independent command labels, groups and aliases.
export function filterCommands(commands, query) {
  const terms=query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if(!terms.length)return commands;
  return commands.filter(command=>{
    const haystack=[command.label,command.group,command.shortcut,...(command.aliases||[])].filter(Boolean).join(' ').toLocaleLowerCase();
    return terms.every(term=>haystack.includes(term));
  });
}
