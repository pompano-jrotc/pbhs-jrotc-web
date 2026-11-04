// src/components/AdminPageHeader.jsx
//
// Standardized header block for every admin page.

import React from 'react';

const AdminPageHeader = ({ icon: Icon, title, meta }) => (
  <div className="mb-8">
    <h1 className="text-4xl font-black uppercase italic tracking-tighter text-slate-900 dark:text-white flex items-center gap-3">
      {Icon && <Icon size={32} className="text-yellow-500 flex-shrink-0" />}
      {title}
    </h1>

    {meta && (
      <p className="mt-1.5 text-sm text-slate-400 dark:text-slate-500 ml-0">
        {meta}
      </p>
    )}
  </div>
);

export default AdminPageHeader;
