use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

// Only released, version-tagged assets from our own repository may be used.
// Arbitrary URLs, custom servers and untrusted keys are never accepted.
fn safe_release(tag:&str, version:&str)->bool{
    if tag!=format!("v{version}") || version.len()>64{return false;}
    let parts:Vec<&str>=version.splitn(2,"-experimental.").collect();
    let Some(base)=parts.first() else{return false};
    let numbers:Vec<&str>=base.split('.').collect();
    if numbers.len()!=3 || numbers.iter().any(|n|n.is_empty()||n.len()>9||!n.bytes().all(|b|b.is_ascii_digit())) {
        return false;
    }
    if parts.len()==2 {
        let suffix=parts[1];
        if suffix.is_empty() || suffix.len()>9 || !suffix.bytes().all(|b|b.is_ascii_digit()) {
            return false;
        }
    }
    true
}

#[tauri::command]
pub async fn install_signed_release(app:AppHandle,tag:String,version:String)->Result<(),String>{
    if option_env!("LOOPSITE_SIGNED_UPDATES")!=Some("1") ||
       option_env!("LOOPSITE_PORTABLE")==Some("1") {
        return Err("Automatic installation requires an official signed, installed build.".into());
    }
    if !safe_release(&tag,&version) {
        return Err("Invalid release version.".into());
    }
    let manifest=format!(
      "https://github.com/VoidRaxx/LoopSite-Studio/releases/download/{tag}/latest.json"
    );
    let url=manifest.parse().map_err(|e|format!("Invalid manifest URL: {e}"))?;
    let updater=app.updater_builder()
        .endpoints(vec![url]).map_err(|e|e.to_string())?
        .build().map_err(|e|e.to_string())?;
    let selected=updater.check().await.map_err(|e|e.to_string())?
        .ok_or("No newer signed release found.")?;
    if selected.version!=version {
        return Err("Signed release version does not match the changelog dialog.".into());
    }
    selected.download_and_install(|_,_|{},||{})
        .await.map_err(|e|format!("Signed update failed: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn only_tagged_releases_are_installable(){
        assert!(safe_release("v0.2.0","0.2.0"));
        assert!(safe_release("v0.2.0-experimental.3","0.2.0-experimental.3"));
        for (tag,version) in [
            ("v0.2.0/../../bad","0.2.0/../../bad"),
            ("v0.2.0-experimental.foo","0.2.0-experimental.foo"),
            ("v0.2.0","0.2.1"),("v0.1.0+bad","0.1.0+bad")
        ]{assert!(!safe_release(tag,version));}
    }
}
