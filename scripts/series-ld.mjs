// The all-versions record series as a complete schema.org Dataset, for the
// isPartOf entry of every record page. Google validates nested Datasets too, so
// this node carries its own description, license and creator. The description
// is the opening of the series description in ane-research-records/.zenodo.json;
// license and creator match that file (cc-by-4.0; Wilson, Nayte, ORCID).
export const SERIES_DESCRIPTION = 'Versioned, source-bound public research records from MacBrains Labs. Each version is a cumulative snapshot of the archive repository.';
export const CREATOR = { '@type': 'Person', name: 'Nayte Wilson', identifier: 'https://orcid.org/0009-0003-4026-8212' };
export const LICENSE = 'https://creativecommons.org/licenses/by/4.0/';
export const seriesDataset = (name, conceptDoi) => ({
  '@type': 'Dataset', name, description: SERIES_DESCRIPTION,
  identifier: `https://doi.org/${conceptDoi}`, url: `https://doi.org/${conceptDoi}`,
  license: LICENSE, creator: CREATOR
});
