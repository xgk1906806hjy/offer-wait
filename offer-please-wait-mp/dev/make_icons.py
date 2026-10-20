"""生成 tabBar 图标（81x81 PNG），无外部素材依赖。"""
from PIL import Image, ImageDraw

S = 324  # 4x 超采样后缩放，边缘更干净
NORMAL = (138, 129, 117, 255)   # #8A8175
ACTIVE = (175, 58, 42, 255)     # #AF3A2A


def canvas():
    return Image.new("RGBA", (S, S), (0, 0, 0, 0))


def save(img, name):
    img.resize((81, 81), Image.LANCZOS).save(name)
    print("wrote", name)


def plaza(color):
    img = canvas()
    d = ImageDraw.Draw(img)
    bars = [(60, 78, 264, 108), (60, 147, 264, 177), (60, 216, 210, 246)]
    for b in bars:
        d.rounded_rectangle(b, radius=14, fill=color)
    return img


def add(color):
    img = canvas()
    d = ImageDraw.Draw(img)
    d.ellipse((62, 62, 262, 262), outline=color, width=24)
    d.rounded_rectangle((148, 100, 176, 224), radius=14, fill=color)
    d.rounded_rectangle((100, 148, 224, 176), radius=14, fill=color)
    return img


def mine(color):
    img = canvas()
    d = ImageDraw.Draw(img)
    d.ellipse((108, 54, 216, 162), fill=color)
    d.pieslice((66, 196, 258, 388), 180, 360, fill=color)
    return img


if __name__ == "__main__":
    save(plaza(NORMAL), "tab-plaza.png")
    save(plaza(ACTIVE), "tab-plaza-on.png")
    save(add(NORMAL), "tab-add.png")
    save(add(ACTIVE), "tab-add-on.png")
    save(mine(NORMAL), "tab-mine.png")
    save(mine(ACTIVE), "tab-mine-on.png")
