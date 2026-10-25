// Business-runtime fixture only. Production always uses cloudflare/worker.mjs,
// where the central access gate runs before serveAuthorized.
import {serveAuthorized} from '../../cloudflare/worker.mjs';
export {PicksStore} from '../../cloudflare/worker.mjs';
export default {fetch:serveAuthorized};
