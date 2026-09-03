import journal from "./meta/_journal.json";
import m0000 from "./0000_init.sql";
import m0001 from "./0001_user-do-tables.sql";
import m0002 from "./0002_mm-sidebar-status.sql";
import m0003 from "./0003_worried_alex_power.sql";

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
  },
};
