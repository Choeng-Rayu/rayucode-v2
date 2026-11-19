use crate::tui::color_support::rgb;
use ratatui::prelude::*;

pub(crate) const BRAND_GLYPH: &str = "◈";
pub(crate) const WELCOME_TITLE: &str = "Welcome to RayuCode";
pub(crate) const WELCOME_TAGLINE: &str = "Thank you for choosing RayuCode";

/// Exact ANSI Shadow "RAYU" ASCII art lines shared with rayu-cli.
const RAYU_BANNER_ART: [&str; 6] = [
    "██████╗  █████╗ ██╗   ██╗██╗   ██╗",
    "██╔══██╗██╔══██╗╚██╗ ██╔╝██║   ██║",
    "██████╔╝███████║ ╚████╔╝ ██║   ██║",
    "██╔══██╗██╔══██║  ╚██╔╝  ██║   ██║",
    "██║  ██║██║  ██║   ██║   ╚██████╔╝",
    "╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝ ",
];

/// Minimum terminal columns required to render the 34-cell ANSI Shadow banner
/// cleanly with 1 column of horizontal margin on each side.
pub(crate) const BANNER_MIN_WIDTH: u16 = 36;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BannerVariant {
    Clawd,
    Welcome,
}

impl BannerVariant {
    const fn gradient(self) -> [(u8, u8, u8); 6] {
        match self {
            // Cyan -> violet gradient (#22d3ee -> #c084fc)
            Self::Clawd => [
                (34, 211, 238),
                (56, 189, 248),
                (96, 165, 250),
                (129, 140, 248),
                (167, 139, 250),
                (192, 132, 252),
            ],
            // Lime -> emerald gradient (#cfff7c -> #0e7a40)
            Self::Welcome => [
                (207, 255, 124),
                (91, 245, 141),
                (34, 224, 201),
                (34, 160, 242),
                (100, 184, 21),
                (14, 122, 64),
            ],
        }
    }
}

/// Render the centered ANSI Shadow "RAYU" banner when `max_width >= BANNER_MIN_WIDTH`.
pub(crate) fn banner_lines(variant: BannerVariant, max_width: u16) -> Vec<Line<'static>> {
    if max_width < BANNER_MIN_WIDTH {
        return Vec::new();
    }
    RAYU_BANNER_ART
        .iter()
        .zip(variant.gradient())
        .map(|(text, (r, g, b))| {
            Line::from(Span::styled(*text, Style::default().fg(rgb(r, g, b))))
                .alignment(Alignment::Center)
        })
        .collect()
}

/// Centered RayuCode welcome title, styled with emerald accent.
pub(crate) fn welcome_title_line(accent: Color) -> Line<'static> {
    Line::from(vec![
        Span::styled(
            format!("{BRAND_GLYPH} "),
            Style::default().fg(rgb(34, 211, 238)),
        ),
        Span::styled(
            WELCOME_TITLE,
            Style::default().fg(accent).add_modifier(Modifier::BOLD),
        ),
    ])
    .alignment(Alignment::Center)
}

/// Centered RayuCode welcome tagline.
pub(crate) fn welcome_tagline_line() -> Line<'static> {
    Line::from(Span::styled(
        WELCOME_TAGLINE,
        Style::default().fg(rgb(34, 224, 99)),
    ))
    .alignment(Alignment::Center)
}
