// The publishable key is meant to be public; the database's row-level security decides who can read and write what.
// Same project as Operations, so people use the same login in both apps.
window.NP_CONFIG = {
  supabaseUrl: 'https://iyyzqyijdozojebzhsrk.supabase.co',
  supabaseAnonKey: 'sb_publishable_WIjeS6YylZAR49SjcuTIvQ_L7w7Vt0T',
  hiddenVenues: ['cleaning','design']        // Operations areas that are not places people clock in at
};
