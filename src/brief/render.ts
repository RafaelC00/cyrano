import type { BriefDate, WeeklyBrief, Why } from './brief.ts';

const wrap = (text: string, indent: string, width = 92): string => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (indent + cur + ' ' + w).length > width) {
      lines.push(indent + cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(indent + cur);
  return lines.join('\n');
};

function whyBlock(why: Why, indent: string): string {
  return [wrap(`Why her: ${why.headline}`, indent), ...why.evidence.map((e) => wrap(`- ${e}`, indent + '  '))].join('\n');
}

function dateBlock(d: BriefDate, i: number): string {
  const head = `${i + 1}. ${d.status === 'confirmed' ? 'CONFIRMED' : 'PROPOSED '}  ${d.when.local}  ${d.when.kind}  ${d.where.place ? `${d.where.place}, ` : ''}${d.where.city} (${d.when.timezone})`;
  const lines = [head, `   ${d.name}${d.age !== null ? `, ${d.age}` : ''}`, whyBlock(d.why, '   ')];
  if (d.alternatives.length) lines.push(`   Also offered: ${d.alternatives.join('; ')}`);
  if (d.travelNote) lines.push(wrap(`Note: ${d.travelNote}`, '   '));
  return lines.join('\n');
}

/** Plain text, readable in a terminal or pasted into a message. */
export function renderBrief(b: WeeklyBrief): string {
  const out: string[] = [];
  out.push(`CYRANO weekly brief, week of ${b.weekOf}`, '='.repeat(60), '');
  out.push('DATES', '-----');
  out.push(b.dates.length ? b.dates.map(dateBlock).join('\n\n') : '   Nothing arranged yet.');
  out.push('', 'STILL YOURS TO DECIDE', '---------------------');
  if (b.pending.length) for (const p of b.pending) out.push(wrap(`* ${p.text}`, '  '));
  else out.push('   Nothing waiting.');
  if (b.atTheGate.length) {
    out.push('', 'AT THE GATE (best first)', '------------------------');
    b.atTheGate.forEach((g, i) => out.push(`${i + 1}. ${g.name}${g.rank ? ` (rank ${g.rank})` : ''}`, wrap(g.why.headline, '   ')));
  }
  out.push('', 'DROPPED, AND LEAST SURE ABOUT', '-----------------------------');
  if (b.leastSure.length) {
    for (const d of b.leastSure) {
      out.push(`* ${d.name}  [${d.rule}]  confidence in the drop ${d.confidence}`);
      out.push(wrap(d.reason, '    '), wrap(`Unsure because: ${d.whyUnsure}`, '    '), `    To bring her back: ${d.undo}`);
    }
  } else out.push('   Nothing dropped.');
  out.push('', wrap(b.basis, ''));
  return out.join('\n') + '\n';
}
