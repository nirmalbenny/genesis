// Test stand-in only. In a preview, PreviewPanel injects the real src/genesis/hl.registry.js: the same endpoints as
// plain data (frontend/src/lib/registry.ts clientRegistry()), since the preview can't read the registry files.
import { clientRegistry } from '@/lib/registry'

export default clientRegistry()
