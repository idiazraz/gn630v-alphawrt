# Port of libre rem/dtmf/dec.c + goertzel, to test DTMF detection with dial-tone echo,
# with and without a 425 Hz notch in front (the fix proposed for fxs.c).
import math
FS=8000; N=102
FX=[1209,1336,1477,1633]; FY=[697,770,852,941]
KEYS=[['1','2','3','A'],['4','5','6','B'],['7','8','9','C'],['*','0','#','D']]
THR=16439.10631*N*N; EFAC=0.822243*N
def s16(v): return max(-32768,min(32767,int(v)))
def gz(samples,f):
    c=2*math.cos(2*math.pi*f/FS); q1=q2=0.0
    for s in samples+[0]: q0=c*q1-q2+s; q2=q1; q1=q0
    return 2*(q1*q1+q2*q2-q1*q2*c)
def decode(b):
    ex=[gz(b,f) for f in FX]; ey=[gz(b,f) for f in FY]
    x=max(range(4),key=lambda i:ex[i]); y=max(range(4),key=lambda i:ey[i])
    if ex[x]<THR or ey[y]<THR: return None
    if ex[x]>ey[y]*6.309573 or ey[y]>ex[x]*2.511886: return None
    if any(i!=x and ex[i]*6.309573>ex[x] for i in range(4)) or any(i!=y and ey[i]*6.309573>ey[y] for i in range(4)): return None
    if ex[x]+ey[y] < EFAC*sum(s*s for s in b): return None
    return KEYS[y][x]
class Notch:  # RBJ biquad notch
    def __init__(s,f0,q):
        w=2*math.pi*f0/FS; a=math.sin(w)/(2*q); a0=1+a
        s.b=[1/a0,-2*math.cos(w)/a0,1/a0]; s.a=[-2*math.cos(w)/a0,(1-a)/a0]; s.z=[0.0,0.0]
    def __call__(s,x):
        y=s.b[0]*x+s.z[0]; s.z[0]=s.b[1]*x-s.a[0]*y+s.z[1]; s.z[1]=s.b[2]*x-s.a[1]*y; return y
def run(key,dt_ratio,notch,ms=100):
    y,x=[(r,c) for r in range(4) for c in range(4) if KEYS[r][c]==key][0]
    A=3000; B=A*dt_ratio; n=FS*ms//1000+N*2
    sig=[A*math.sin(2*math.pi*FY[y]*t/FS)+A*0.8*math.sin(2*math.pi*FX[x]*t/FS)+B*math.sin(2*math.pi*425*t/FS+0.3) for t in range(n)]
    if notch: f=Notch(425,2.0); sig=[f(v) for v in sig]
    sig=[s16(v) for v in sig]
    got=[decode(sig[i:i+N]) for i in range(N,len(sig)-N+1,N)]  # skip first block (filter settling)
    return key in got
for r in [0,0.3,0.5,0.7,1.0,2.0,4.0]:
    print(f"dial-tone echo {r:>4}x DTMF: plain={'ok ' if all(run(k,r,False) for k in '159*0#') else 'MISS'} notch={'ok ' if all(run(k,r,True) for k in '159*0#') else 'MISS'}")
assert all(run(k,0,True) for k in '1234567890*#'), 'notch must not break clean digits'
print('clean digits through the notch: ok')
