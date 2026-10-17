use anyhow::Result;
use image::{DynamicImage, ImageFormat, ImageReader, Limits, imageops::FilterType};
use std::io::Cursor;

/// Larger inputs are refused unread.
pub const MAX_BYTES: usize = 10 * 1024 * 1024;

/// Shrinks so the longest side is at most `max_side` (never enlarges), keeping the
/// aspect ratio. JPEG, or PNG when the source has an alpha channel. Refuses inputs over
/// `MAX_BYTES` or 8192 px a side, and caps decoder memory, so a decompression bomb fails.
pub fn downscale(bytes: &[u8], max_side: u32) -> Result<(Vec<u8>, &'static str)> {
    anyhow::ensure!(bytes.len() <= MAX_BYTES, "image over 10 MB");
    let mut limits = Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(256 * 1024 * 1024);
    let mut reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    reader.limits(limits);
    let mut img = reader.decode()?;
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
    fn oversized_dimensions_are_refused() {
        assert!(downscale(&png(&DynamicImage::new_luma8(9000, 1)), 1024).is_err());
        assert!(downscale(&vec![0; MAX_BYTES + 1], 1024).is_err());
    }

    #[test]
    fn alpha_stays_png() {
        let (out, mime) = downscale(&png(&DynamicImage::new_rgba8(40, 20)), 10).unwrap();
        assert_eq!((dims(&out), mime), ((10, 5), "image/png"));
    }
}
