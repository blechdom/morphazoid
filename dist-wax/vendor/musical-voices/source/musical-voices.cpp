// STK wrapper and C++ translation of Cook's Singer as distributed with Snd.
// Upstream sources/licenses and exact adaptation boundaries: README.md.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>
#include "VoicForm.h"
#include "Phonemes.h"
#include "singer-data.h"
using std::array;
static constexpr double SR=22050.0, PI=3.14159265358979323846;
struct Model { virtual ~Model()=default; virtual bool valid(){return true;} virtual double tick()=0; virtual bool phone(int)=0; virtual void control(int,double)=0; virtual void release()=0; };
struct StkVoice: Model, stk::VoicForm {
  double commandedPitch=220, formantScale=1; int currentPhone=0,invalidFormants=0;
  bool valid() override {return invalidFormants==0;}
  void scaleFormants(){invalidFormants=0;for(int i=0;i<4;i++){double hz=formantScale*stk::Phonemes::formantFrequency(currentPhone,i);if(hz<0||hz>SR*.5){invalidFormants|=1<<i;continue;}filters_[i].setTargets(hz,stk::Phonemes::formantRadius(currentPhone,i),pow(10.0,stk::Phonemes::formantGain(currentPhone,i)/20.0));}}
  StkVoice(){noise_.setSeed(1);stk::VoicForm::setFrequency(220);phone(0);control(2,.01);control(3,6);control(4,0);}
  double tick() override {return stk::VoicForm::tick();}
  bool phone(int i) override {if(i<0||i>=32)return false;currentPhone=i;bool ok=setPhoneme(stk::Phonemes::name(i));scaleFormants();return ok;}
  void control(int n,double v) override {
    switch(n){
      case 0:if(v!=commandedPitch){setFrequency(v);commandedPitch=v;}break;
      case 1:voiced_->setGainTarget(v);break;
      case 2:voiced_->setVibratoGain(v);break;
      case 3:voiced_->setVibratoRate(v);break;
      case 4:voiced_->setRandomGain(v);break;
      case 5:setUnVoiced(v);break;
      case 6:voiced_->setSweepRate(v);break;
      case 7:for(int i=0;i<4;i++)filters_[i].setSweepRate(v);break;
      case 8:onepole_.setPole(v);break;
      case 12:formantScale=v;scaleFormants();break;
      case 13:voiced_->setGainRate(v);break;
      case 14:noiseEnv_.setRate(v);break;
      case 15:onezero_.setZero(v);break;
      case 16:case 17:case 18:case 19:filters_[n-16].setSweepRate(v);break;
      default:break;
    }
  }
  void formant(int i,double hz,double radius,double gain){if(i<0||i>=4)return;if(!std::isfinite(hz)||!std::isfinite(radius)||!std::isfinite(gain)||hz<0||hz>SR*.5||radius<0||radius>=1){invalidFormants|=1<<i;return;}invalidFormants&=~(1<<i);filters_[i].setTargets(hz,radius,gain);}
  void release() override {quiet();}
};
struct Singer: Model {
  array<double,17> radii{},target{};
  array<double,9> coeff{},d1{},d2{};
  array<double,6> nc{0,-.29,-.22,0,.24,.3571},n1{},n2{};
  array<double,1001> glot{},oldGlot{};
  array<double,4> noiseCoeff{},noiseHistory{};
  double pitch=220,glotGain=.8,noiseAmount=0,vibDepth=.01,vibRate=6,jitterDepth=.02;
  double radiiPole=.998,tongueHumpPole=-1,tongueTipPole=-1,jitterRate=10,velumOverride=-1,shapeScale=1;
  bool humpOverride=false,tipOverride=false,velumEdited=false;
  double phase=0,vibPhase=0,jitterPhase=0,jitterFrom=0,jitterTo=0;
  double lipIn=0,lipOut=0,lipRefl=0,lastTract=0,throat=0;
  double noseMinus=0,nosePlus=0,noseOut=0,noseFilt=0;
  double noiseIn1=0,noiseIn2=0,noiseOut=0,alpha1=0,alpha2=0,alpha3=0;
  double glotMix=0,glotMixStep=0,glotEnvelope=0;
  uint32_t rng=1;int noseClosed=1000,shapeIndex=0;bool first=true,released=false;
  Singer(){phone(singer_shape_index("ahh"));first=true;setGlot(0,0);}
  double random(){rng^=rng<<13;rng^=rng>>17;rng^=rng<<5;return (double(rng)/4294967295.0)*2-1;}
  bool phone(int i) override {
    if(i<0||i>=SINGER_SHAPE_COUNT)return false;
    shapeIndex=i;for(int j=0;j<17;j++)target[j]=SINGER_SHAPES[i][j];
    if(first){radii=target;first=false;}
    return true;
  }
  void control(int n,double v) override {
    switch(n){
      case 0:pitch=v;break;
      case 1:glotGain=v;released=false;break;
      case 2:vibDepth=v;break;
      case 3:vibRate=v;break;
      case 4:jitterDepth=v;break;
      case 5:noiseAmount=v;break;
      case 7:radiiPole=v;break;
      case 9:velumOverride=v;velumEdited=true;break;
      case 10:shapeScale=v;break;
      case 20:tongueHumpPole=v;humpOverride=true;break;
      case 21:tongueTipPole=v;tipOverride=true;break;
      case 22:jitterRate=v;break;
      default: if(n>=32&&n<49)target[n-32]=v;break;
    }
  }
  void release() override {released=true;glotGain=0;noiseAmount=0;}
  // The sine/cosine glottal coefficient equations are translated from singer.scm.
  void setGlot(int which,int transition){
    if(which<0||which>=SINGER_GLOT_COUNT)return;
    setGlotParameters(int(SINGER_GLOTS[which][0]),SINGER_GLOTS[which][1],SINGER_GLOTS[which][2],transition);
  }
  void setGlotParameters(double harmonics,double a,double b,int transition){
    // Upstream uses200-element Fourier coefficient arrays; lower values
    // produce an empty table when the native loops have no harmonics.
    if(!std::isfinite(harmonics)||harmonics>=200||!std::isfinite(a)||!std::isfinite(b))return;
    const int harms=harmonics<1?0:int(floor(harmonics));
    oldGlot=glot;
    const double unit=.159154943,a2=2*PI*a,b2=2*PI*b,ba=b-a;
    const double sa=sin(a2),ca=cos(a2);double temp=0,temp1=0;
    array<double,200> ss{},cc{};
    if(b!=a){temp=unit/ba;temp1=1-ca;ss[1]=(ca+(sa-sin(b2))*temp)*temp1*unit;cc[1]=((ca-cos(b2))*temp-sa)*temp1*unit;}
    ss[1]+=((.75+cos(2*a2)*.25)-ca)*unit;
    cc[1]+=(sa-sin(2*a2)*.25)*unit-a*.5;
    for(int k=2;k<=harms;k++){
      const double ka2=k*a2,ka1=(k-1)*a2,ka3=(k+1)*a2;
      if(b!=a){temp=unit/(ba*k);ss[k]=(cos(ka2)+(sin(ka2)-sin(k*b2))*temp)*(temp1/k);cc[k]=((cos(ka2)-cos(k*b2))*temp-sin(ka2))*(temp1/k);}
      ss[k]=(ss[k]+(1-cos(ka2))/k+(cos(ka1)-1)*.5/(k-1)+(cos(ka3)-1)*.5/(k+1))*unit;
      cc[k]=(cc[k]+sin(ka2)/k-sin(ka1)*.5/(k-1)-sin(ka3)*.5/(k+1))*unit;
    }
    for(int j=0;j<=1000;j++){double x=2*PI*j/1000;glot[j]=0;for(int k=1;k<=harms;k++)glot[j]+=cc[k]*cos(k*x)+ss[k]*sin(k*x);}
    glotMix=transition>0?1:0;glotMixStep=transition>0?1.0/transition:0;
  }
  double tractFilter(int beg,int end,double temp){
    for(int k=beg,j=beg+1;j<end;k++,j++){double x=d2[j+1];d2[j]=x+coeff[j]*(d1[k]-x);double prev=temp;temp=d1[k]+d2[j]-x;d1[k]=prev;}return temp;
  }
  double noseFilter(double temp){
    for(int k=1,j=2;j<5;k++,j++){double refl=nc[j]*(n1[k]-n2[j+1]);n2[j]=n2[j+1]+refl;double prev=temp;temp=n1[k]+refl;n1[k]=prev;}return temp;
  }
  double tick() override {
    // Same per-radius first-order trajectory smoothing as the source model.
    for(int i=0;i<17;i++){double pole=(i>=2&&i<=4&&humpOverride)?tongueHumpPole:(i==5&&tipOverride)?tongueTipPole:radiiPole;radii[i]=radii[i]*pole+target[i]*(1-pole);}
    array<double,17> r=radii;for(int i=0;i<8;i++)r[i]*=shapeScale;if(velumEdited)r[16]=velumOverride;
    double tj=1;
    for(int k=0,j=1;j<9;k++,j++){double tk=tj;tj=r[j]==0?1e-10:r[k]*r[k];coeff[j]=(tk-tj)/(tk+tj);}
    double glotReflection=r[8],lipReflection=r[9];int noisePos=(r[10]>=0&&r[10]<9)?int(floor(r[10])):-1;double noiseGain=r[11],lipRadius=r[7],velum=r[16];
    double na=-2*cos(2*PI*r[12]/SR)*r[13],nb=r[13]*r[13],na2=-2*cos(2*PI*r[14]/SR)*r[15],nb2=r[15]*r[15];
    noiseCoeff={na+na2,nb+nb2+na*na2,na2*nb+nb2*na,nb2*nb};
    double right=std::max(r[2]-velum,0.0);alpha1=r[1]*r[1];alpha2=right*right;alpha3=velum*velum;double total=2/std::max(1e-20,alpha1+alpha2+alpha3);alpha1*=total;alpha2*=total;alpha3*=total;
    if(jitterPhase>=1){jitterPhase-=1;jitterFrom=jitterTo;jitterTo=random();}jitterPhase+=jitterRate/SR;
    double jitter=jitterDepth*(jitterFrom+(jitterTo-jitterFrom)*jitterPhase);
    double increment=pitch*(1+vibDepth*sin(vibPhase)+jitter)*1000/SR;vibPhase+=2*PI*vibRate/SR;if(vibPhase>2*PI)vibPhase-=2*PI;
    glotEnvelope+=(glotGain-glotEnvelope)*.01;
    lipOut=lipIn+lastTract;lipRefl=lipOut*lipReflection;lipIn=lastTract;
    double glotSample=d2[1]*glotReflection;
    phase+=increment;if(!std::isfinite(phase))return NAN;if(phase>=2000||phase<=-1000)phase=fmod(phase,1000);while(phase>=1000)phase-=1000;while(phase<0)phase+=1000;int loc=int(phase);glotMix=std::max(0.0,glotMix-glotMixStep);
    glotSample+=glotEnvelope*(glot[loc]+glotMix*(oldGlot[loc]-glot[loc]));
    double temp=d2[2];throat=.05*(d1[2]+temp)+.05*.9995*throat;
    d2[1]=temp+coeff[1]*(glotSample-temp);temp=glotSample+d2[1]-temp;temp=tractFilter(1,3,temp);
    double plus=d1[2],minus=d2[4],refl=alpha1*plus+alpha2*minus+alpha3*n2[1];noseMinus=refl-plus;nosePlus=refl-minus;
    if(!(velum==0&&noseClosed>=1000)){
      noseClosed=velum==0?noseClosed+1:0;double plusIn=velum*(refl-n2[1]);refl=nc[1]*(plusIn-n2[2]);n2[1]=n2[2]+refl;
      double nt=noseFilter(plusIn+refl);refl=nc[5]*(n1[4]-noseOut*.25);n2[5]=noseOut*.25+refl;n1[5]=n1[4]+refl;n1[4]=nt;
      double prev=noseFilt;noseFilt=n1[5];noseOut=(noseFilt+prev)*.5;
    }
    d2[3]=noseMinus;d1[2]=temp;
    temp=tractFilter(3,8,nosePlus);d2[8]=lipRefl+coeff[8]*(d1[7]-lipRefl);d1[8]=d1[7]+d2[8]-lipRefl;d1[7]=temp;
    if(noiseGain!=0){if(noisePos<0)return NAN;double ni=random(),filtered=noiseCoeff[0]*noiseOut;for(int j=1;j<4;j++)filtered+=noiseCoeff[j]*noiseHistory[j-1];for(int j=2;j>0;j--)noiseHistory[j]=noiseHistory[j-1];noiseHistory[0]=noiseOut;noiseOut=ni-noiseIn2-filtered;noiseIn2=noiseIn1;noiseIn1=ni;if(noisePos>=0&&noisePos<9)d1[noisePos]+=noiseOut*noiseGain*noiseAmount;}
    lastTract=d1[8]*lipRadius;return .1*(lipOut+noseOut+throat);
  }
};
static std::vector<Model*> models(1,nullptr);
extern "C" {
int voice_create(int type){stk::Stk::setSampleRate(SR);stk::Stk::setRawwavePath("/");try{Model*p=type==0?static_cast<Model*>(new StkVoice()):static_cast<Model*>(new Singer());for(unsigned i=1;i<models.size();i++)if(!models[i]){models[i]=p;return i;}models.push_back(p);return models.size()-1;}catch(...){return 0;}}
void voice_destroy(int id){if(id>0&&id<int(models.size())){delete models[id];models[id]=nullptr;}}
int voice_phone(int id,int phone){return id>0&&id<int(models.size())&&models[id]&&models[id]->phone(phone);}
void voice_control(int id,int param,double value){if(id>0&&id<int(models.size())&&models[id]&&std::isfinite(value))models[id]->control(param,value);}
void voice_glot(int id,int glot,int transition){if(id>0&&id<int(models.size()))if(auto*p=dynamic_cast<Singer*>(models[id]))p->setGlot(glot,transition);}
void voice_glot_parameters(int id,double harms,double a,double b,int transition){if(id>0&&id<int(models.size()))if(auto*p=dynamic_cast<Singer*>(models[id]))p->setGlotParameters(harms,a,b,transition);}
void voice_formant(int id,int n,double hz,double radius,double gain){if(id>0&&id<int(models.size()))if(auto*p=dynamic_cast<StkVoice*>(models[id]))p->formant(n,hz,radius,gain);}
void voice_release(int id){if(id>0&&id<int(models.size())&&models[id])models[id]->release();}
int voice_render(int id,float*out,int count){if(id<=0||id>=int(models.size())||!models[id]||count<0||count>int(SR*60))return -1;if(!models[id]->valid())return -3;for(int i=0;i<count;i++){double x=models[id]->tick();if(!std::isfinite(x))return -2;out[i]=std::copysign(std::min(std::abs(x),double(std::numeric_limits<float>::max())),x);}return count;}
}
