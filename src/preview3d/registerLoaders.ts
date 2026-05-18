// Side-effect imports — each loader self-registers via registerModelLoader()
// at module load. Importing this file once boots the loader registry.
import './loadGLB';
import './loadFBX';
import './loadKN5';
