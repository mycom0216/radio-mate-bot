// Pack entries into one <=200-code-point reply; the user explicitly requests each page.
export function chatPage(label, entries, arg, command, empty) {
  if (!entries.length) return empty;
  if (arg && !/^[1-9]\d{0,5}$/.test(arg)) return `사용법: !${command} 페이지번호`;
  const cut = (s, n) => [...String(s)].slice(0, n).join('');
  const pages = []; let lines = [];
  for (const entry of entries) {
    const line = cut(entry, 130);
    if ([...lines.concat(line).join('\n')].length > 145 && lines.length) { pages.push(lines.join('\n')); lines = []; }
    lines.push(line);
  }
  if (lines.length) pages.push(lines.join('\n'));
  if(pages.length===1&&!arg)return pages[0];
  const page = Number(arg || 1);
  if (page > pages.length) return `${label}: 1~${pages.length}페이지를 입력하세요.`;
  return `${label} ${page}/${pages.length}\n${pages[page-1]}${page < pages.length ? `\n다음: !${command} ${page+1}` : ''}`;
}
