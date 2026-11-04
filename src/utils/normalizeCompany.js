// src/utils/normalizeCompany.js
//
// Centralised company-name normalisation for display and HQ detection.
// Firestore still holds legacy records with company:'Zulu' — this maps them
// to 'Battalion' so the UI never shows 'Zulu' to any user.

export const normalizeCompany = (co) => (co === 'Zulu' ? 'Battalion' : (co || ''));

export const isHQCompany = (co) => co === 'Battalion' || co === 'Zulu';
