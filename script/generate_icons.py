import os
from PIL import Image

def generate_icons(source_path, output_dir):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    img = Image.open(source_path)
    
    # Generate .ico for Windows
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(os.path.join(output_dir, 'icon.ico'), sizes=ico_sizes)
    print(f"Generated icon.ico in {output_dir}")
    
    # Generate PNGs for various uses
    png_sizes = [16, 32, 48, 64, 128, 256, 512, 1024]
    for size in png_sizes:
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(os.path.join(output_dir, f'icon_{size}.png'))
        print(f"Generated icon_{size}.png")

if __name__ == "__main__":
    source = "docs/logo.png"
    output = "desktop/assets/icons"
    generate_icons(source, output)
