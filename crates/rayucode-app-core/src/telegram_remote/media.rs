use anyhow::{Context, Result, bail, ensure};
use rayucode_base::telegram::remote::{Mode, Transport};
use serde_json::Value;
use tokio::io::AsyncReadExt;

use crate::tool::{ToolContext, ToolOutput};

pub(crate) async fn send(input: Value, ctx: &ToolContext) -> Result<ToolOutput> {
    let raw = input
        .get("path")
        .and_then(Value::as_str)
        .context("A media path is required")?;
    let root = ctx
        .working_dir
        .as_deref()
        .context("The Telegram session needs a working directory")?
        .canonicalize()?;
    let path = root.join(raw).canonicalize()?;
    ensure!(
        path.starts_with(&root) && path.is_file(),
        "Media must be a file in the session directory"
    );
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default();
    let video = extension.eq_ignore_ascii_case("mp4");
    ensure!(
        video
            || ["png", "jpg", "jpeg", "webp"]
                .iter()
                .any(|ext| extension.eq_ignore_ascii_case(ext)),
        "Choose a PNG, JPEG, WebP, or MP4 file"
    );
    let generation =
        super::approvals::remote_generation(&ctx.session_id).context("Telegram turn has closed")?;
    super::authorize_tool(
        "send_media",
        &serde_json::json!({ "path": path, "destination": "Linked Telegram chat" }),
        &ctx.session_id,
    )
    .await?;
    let link = super::load()?
        .filter(|link| link.generation == generation && link.active_account())
        .context("Telegram link has closed")?;
    let owner = link.owner.context("Telegram chat is disconnected")?;
    let transport = Transport::new(link.mode)?;
    if matches!(transport.mode, Mode::Hosted { .. }) {
        transport
            .send(
                owner,
                "Rayu generated media. Open the local session to view it.",
                None,
            )
            .await?;
        return Ok(ToolOutput::new(
            "Sent notice to the linked Telegram chat. The hosted bot supports text notices for media.",
        ));
    }

    ensure!(
        path.canonicalize()? == path,
        "The media path changed after approval"
    );
    let limit = if video {
        49 * 1024 * 1024
    } else {
        9 * 1024 * 1024
    };
    let mut file = tokio::fs::File::open(&path).await?.take(limit + 1);
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).await?;
    ensure!(
        bytes.len() <= limit as usize,
        "Media exceeds the Telegram upload limit"
    );
    let matches_kind = if video {
        bytes.get(4..8) == Some(b"ftyp")
    } else {
        bytes.starts_with(b"\x89PNG\r\n\x1a\n")
            || bytes.starts_with(b"\xff\xd8\xff")
            || (bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"))
    };
    if !matches_kind {
        bail!("File contents do not match the requested media type");
    }
    transport
        .upload(owner, bytes, &format!("rayu-media.{extension}"), video)
        .await?;
    Ok(ToolOutput::new("Sent media to the linked Telegram chat."))
}
