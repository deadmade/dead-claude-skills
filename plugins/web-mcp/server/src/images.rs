use anyhow::Result;
use image::{DynamicImage, ImageFormat, imageops::FilterType};
use std::io::Cursor;

/// Shrinks so the longest side is at most `max_side` (never enlarges), keeping the
/// aspect ratio. JPEG, or PNG when the source has an alpha channel.
pub fn downscale(bytes: &[u8], max_side: u32) -> Result<(Vec<u8>, &'static str)> {
    let mut img = image::load_from_memory(bytes)?;
    if img.width().max(img.height()) > max_side {
        img = img.resize(max_side, max_side, FilterType::Lanczos3);
    }
    let (format, mime, img) = if img.color().has_alpha() {
        (ImageFormat::Png, "image/png", img)
    } else {
        (
            ImageFormat::Jpeg,
            "image/jpeg",
            DynamicImage::ImageRgb8(img.to_rgb8()),
        )
    };
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, format)?;
    Ok((out.into_inner(), mime))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;

    fn dims(bytes: &[u8]) -> (u32, u32) {
        image::load_from_memory(bytes).unwrap().dimensions()
    }

    fn png(img: &DynamicImage) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn downscale_caps_longest_side() {
        let (out, mime) = downscale(include_bytes!("../tests/fixtures/photo.jpg"), 1024).unwrap();
        assert_eq!((dims(&out), mime), ((1024, 512), "image/jpeg"));
        let (out, _) = downscale(&png(&DynamicImage::new_rgb8(300, 200)), 1024).unwrap();
        assert_eq!(dims(&out), (300, 200));
    }

    #[test]
    fn alpha_stays_png() {
        let (out, mime) = downscale(&png(&DynamicImage::new_rgba8(40, 20)), 10).unwrap();
        assert_eq!((dims(&out), mime), ((10, 5), "image/png"));
    }
}
