# Terrain Assets

Place glTF terrain meshes here. The asset loader resolves paths relative to site root.

## First connection target

- **File:** `rock.glb`
- **Registry path:** `/assets/terrain/rock.glb` (in `tile-registry.ts`, rock descriptor)
- **meshName:** `""` (auto-selects first non-`__root__` mesh)

## Naming convention

| Terrain      | Expected file         |
|--------------|-----------------------|
| rock         | `rock.glb`            |
| grass        | `grass.glb`           |
| sand         | `sand.glb`            |
| forest       | `forest.glb`          |
| shallowWater | `shallow-water.glb`   |
| deepWater    | `deep-water.glb`      |

## meshName rules

- Set `meshName` in the registry descriptor to target a specific mesh inside the glTF
- `""` = auto-select the first non-`__root__` mesh
- If `meshName` doesn't match, a warning lists available meshes and the first is used

## Fallback

If a `.glb` file is missing, the asset loader substitutes a placeholder hex-cylinder and logs a warning once. No code changes needed when placing the real file.
