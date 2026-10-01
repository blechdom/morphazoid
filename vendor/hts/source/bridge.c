/* Original Morphazoid bounded browser bridge around unmodified Flite+HTS APIs. */
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdint.h>
#include "flite_hts_engine.h"
static HTS_Engine engine;
static int loaded=0;
static float *output=NULL;
static int output_length=0,event_count=0;
static char phones[1024][16];
static double starts[1024],ends[1024];
int hts_init(void){
 if(loaded)return 1;
 HTS_Engine_initialize(&engine);char* files[1]={"/slt.htsvoice"};
 loaded=HTS_Engine_load(&engine,files,1);HTS_Engine_set_audio_buff_size(&engine,0);return loaded;
}
/* Native vocoder controls added for full-sentence Voicesaurus. */
int hts_configure(double alpha,uint32_t frame_period,double volume_db,double gv_f0,uint32_t sample_rate){
 if(!loaded||!isfinite(alpha)||!isfinite(volume_db)||!isfinite(gv_f0))return 0;
 HTS_Engine_set_alpha(&engine,alpha);HTS_Engine_set_sampling_frequency(&engine,sample_rate);HTS_Engine_set_fperiod(&engine,frame_period);
 HTS_Engine_set_volume(&engine,volume_db);HTS_Engine_set_gv_weight(&engine,1,gv_f0);return 1;
}
uint32_t hts_sample_rate(void){return HTS_Engine_get_sampling_frequency(&engine);}
int hts_render_text(const char*text,double speed,double semitones,double beta,double uv,double gv){
 if(!loaded||!text||strlen(text)>1600||!isfinite(speed)||!isfinite(semitones)||!isfinite(beta)||!isfinite(uv)||!isfinite(gv))return -1;
 Flite_Text_Analyzer analyzer;Flite_Text_Analyzer_initialize(&analyzer);
 Flite_Text_Analyzer_analysis(&analyzer,text);
 char **labels=NULL;int count=0;
 if(!Flite_Text_Analyzer_get_label_data(&analyzer,&labels,&count)||count<1||count>1024){Flite_Text_Analyzer_clear(&analyzer);return -2;}
 HTS_Engine_refresh(&engine);
 HTS_Engine_set_speed(&engine,speed);
 HTS_Engine_add_half_tone(&engine,semitones);
 HTS_Engine_set_beta(&engine,beta);
 HTS_Engine_set_msd_threshold(&engine,1,uv);
 HTS_Engine_set_gv_weight(&engine,0,gv);
 // Native duration prediction runs first. Enforce output/work budgets on its
 // result, rather than restricting the performer's numeric parameter range.
 int ok=HTS_Engine_generate_state_sequence_from_strings(&engine,labels,count);
 if(ok){
  uint64_t frames=0;size_t total=HTS_Engine_get_total_state(&engine);
  for(size_t i=0;i<total;i++)frames+=HTS_Engine_get_state_duration(&engine,i);
  uint64_t samples=frames*(uint64_t)HTS_Engine_get_fperiod(&engine);
  if(frames>50000u||samples>0x1000000u||samples>(uint64_t)HTS_Engine_get_sampling_frequency(&engine)*90u)ok=0;
  if(ok)ok=HTS_Engine_generate_parameter_sequence(&engine);
  if(ok)ok=HTS_Engine_generate_sample_sequence(&engine);
 }
 if(ok){
  size_t length=HTS_Engine_get_nsamples(&engine);
  if(length<1||length>0x1000000u||(uint64_t)length>(uint64_t)HTS_Engine_get_sampling_frequency(&engine)*90u)ok=0;
  else{
   free(output);output=(float*)malloc(sizeof(float)*length);output_length=length;
   if(!output)ok=0;else{
    for(size_t n=0;n<length;n++){double s=HTS_Engine_get_generated_speech(&engine,n);if(!isfinite(s)){ok=0;break;}output[n]=(float)(fmax(-32768,fmin(32767,s))/32768.0);}
    event_count=count;size_t frame=0,states=HTS_Engine_get_nstate(&engine);double frame_seconds=HTS_Engine_get_fperiod(&engine)/(double)HTS_Engine_get_sampling_frequency(&engine);
    for(int n=0;n<count;n++){
     const char*phone=Flite_Text_Analyzer_get_phoneme(&analyzer,n);strncpy(phones[n],phone?phone:"",15);phones[n][15]=0;
     starts[n]=frame*frame_seconds;for(size_t k=0;k<states;k++)frame+=HTS_Engine_get_state_duration(&engine,n*states+k);ends[n]=frame*frame_seconds;
    }
   }
  }
 }
 for(int n=0;n<count;n++)free(labels[n]);free(labels);Flite_Text_Analyzer_clear(&analyzer);
 return ok?output_length:-3;
}
const float*hts_data(void){return output;}
int hts_event_count(void){return event_count;}
const char*hts_event_phone(int n){return n>=0&&n<event_count?phones[n]:"";}
double hts_event_start(int n){return n>=0&&n<event_count?starts[n]:0;}
double hts_event_end(int n){return n>=0&&n<event_count?ends[n]:0;}
void hts_close(void){if(loaded)HTS_Engine_clear(&engine);loaded=0;free(output);output=NULL;output_length=event_count=0;}
