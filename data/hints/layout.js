(function(root) {
  'use strict';

  const hasValue = (entries, key) => entries.some(entry => String(entry?.[key] || '').trim());

  const dropdownLayout = entries => {
    const fields = ['Login'];
    if (hasValue(entries, 'Name')) fields.push('Name');
    if (hasValue(entries, 'group')) fields.push('group');

    return {
      fields,
      key: fields.map(field => field.toLowerCase()).join('-'),
      minWidth: fields.length === 1 ? 280 : fields.length === 2 ? 400 : 460
    };
  };

  const api = {dropdownLayout};
  root.__kpHintsLayout = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
