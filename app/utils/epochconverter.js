export const formatEpochToDateTime = (ms) => {
    if (!ms) return "";
    const formatter = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
    
      const parts = formatter.formatToParts(new Date(ms));
      const map = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    
      return `${map.day} ${map.month} ${map.year} | ${map.hour}:${map.minute}:${map.second}`;
  };

export const formatEpochToDuration = (milliseconds) => {
    if (!milliseconds || milliseconds <= 0) {
      return "0min";
    }

    const totalSeconds = Math.floor(milliseconds / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const minutes = totalMinutes % 60;

    let str = "";
    if (days > 0) str += `${days}d `;
    if (hours > 0) str += `${hours}hr `;
    if (minutes > 0) str += `${minutes}min`;
    
    return str.trim() || "0min";
  };

  export const toFormattedString = (value) => {
    const absValue = Math.abs(value);
    const sign = value < 0 ? "-" : "";

    const trimmedTo2Decimals = (num) => {
      return parseFloat(num.toFixed(1)).toString();
    };

    if (absValue >= 1_000_000_000_000) {
      return `${sign}${trimmedTo2Decimals(value / 1_000_000_000_000)}T`;
    } else if (absValue >= 1_000_000_000) {
      return `${sign}${trimmedTo2Decimals(value / 1_000_000_000)}B`;
    } else if (absValue >= 1_000_000) {
      return `${sign}${trimmedTo2Decimals(value / 1_000_000)}M`;
    } else if (absValue >= 1_000) {
      return `${sign}${trimmedTo2Decimals(value / 1_000)}K`;
    } else {
      return trimmedTo2Decimals(value);
    }
  };

  export const formatLastUpdated = (isoString, { timeZone = 'UTC' } = {}) => {
    const date = new Date(isoString);
    if (isNaN(date)) throw new Error('Invalid date string');
  
    const fmt = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone,
    });
  
    const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
    return `${parts.day} ${parts.month} ${parts.year} | ${parts.hour}:${parts.minute}:${parts.second}`;
  }
