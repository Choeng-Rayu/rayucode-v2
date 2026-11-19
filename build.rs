use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=RAYU_RELEASE_NOTICES");
    let release_notices = std::env::var_os("RAYU_RELEASE_NOTICES").map(PathBuf::from);
    let path = release_notices.clone().unwrap_or_else(|| {
        PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("THIRD_PARTY_NOTICES")
    });
    println!("cargo:rustc-check-cfg=cfg(rayu_embedded_release_notices)");
    if release_notices.is_some() {
        println!("cargo:rustc-cfg=rayu_embedded_release_notices");
    }
    println!("cargo:rerun-if-changed={}", path.display());
    println!("cargo:rustc-env=RAYU_BUNDLED_NOTICES={}", path.display());
}
