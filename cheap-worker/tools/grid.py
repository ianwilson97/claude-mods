# logo PNG -> 8x8 colour grid for half-block text pixel art on a dark terminal
import sys, glob, os, json
from PIL import Image
A=sys.argv[1]; N=8; out={}
def lum(r,g,b): return 0.2126*r+0.7152*g+0.0722*b
for f in sorted(glob.glob(f'{A}/providers/*.png'))+[f'{A}/openrouter.png']:
    im=Image.open(f).convert('RGBA'); w,h=im.size; px=im.load()
    corner=px[0,0]
    if corner[3]>200:  # solid tile behind the mark: make that colour transparent
        for y in range(h):
            for x in range(w):
                r,g,b,a=px[x,y]
                if a>0 and sum(abs(c-k) for c,k in zip((r,g,b),corner[:3]))<60: px[x,y]=(r,g,b,0)
    bb=im.getbbox()
    if bb:  # crop to the mark, centred square
        x0,y0,x1,y1=bb; s=max(x1-x0,y1-y0); cx,cy=(x0+x1)//2,(y0+y1)//2
        im=im.crop((cx-s//2,cy-s//2,cx-s//2+s,cy-s//2+s))
    sm=im.resize((N,N),Image.BOX); p=sm.load(); grid=[]
    for y in range(N):
        row=[]
        for x in range(N):
            r,g,b,a=p[x,y]
            if a<90: row.append(None); continue
            if lum(r,g,b)<70: r,g,b=208,215,222  # dark mark -> light, as in dark mode
            row.append('#%02x%02x%02x'%(r,g,b))
        grid.append(row)
    out[os.path.basename(f)[:-4]]=grid
json.dump(out,open(f'{A}/providers-px.json','w'),separators=(',',':'))
print(len(out),'grids')
