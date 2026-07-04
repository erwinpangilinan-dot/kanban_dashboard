function fieldMatches(field, value, { sundayAlt = false } = {}) {
  if (field === '*') return true;

  for (const part of field.split(',')) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      for (let i = start; i <= end; i += 1) {
        if (i === value || (sundayAlt && i === 7 && value === 0)) return true;
      }
    } else {
      const n = Number(part);
      if (n === value || (sundayAlt && n === 7 && value === 0)) return true;
    }
  }
  return false;
}

function cronMatches(expr, date = new Date()) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [min, hour, dom, month, dow] = parts;
  return (
    fieldMatches(min, date.getMinutes())
    && fieldMatches(hour, date.getHours())
    && fieldMatches(dom, date.getDate())
    && fieldMatches(month, date.getMonth() + 1)
    && fieldMatches(dow, date.getDay(), { sundayAlt: true })
  );
}

module.exports = { cronMatches, fieldMatches };
