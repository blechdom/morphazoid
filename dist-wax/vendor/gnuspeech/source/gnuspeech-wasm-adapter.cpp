// Morphazoid GnuspeechSA browser adapter, 2026. GPL-3.0-or-later.
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <string>
#include "Controller.h"
#include "Exception.h"
#include "global.h"
#include "Log.h"
#include "Model.h"
#include "en/phonetic_string_parser/PhoneticStringParser.h"
#include "en/text_parser/TextParser.h"
#include "TRMControlModelConfiguration.h"
static std::string lastError;
extern "C" {
const char* gs_error() { return lastError.c_str(); }
int gs_synthesize(const char* text, int phonetic) {
  lastError.clear();
  if (!text || !text[0] || std::strlen(text) > 4096) {lastError="Input must contain 1–4096 bytes."; return 1;}
  try {
    const char* config="/voice/en";
    GS::Log::debugEnabled=false;
    std::srand(1);
    auto model=std::make_unique<GS::TRMControlModel::Model>();
    model->load(config,TRM_CONTROL_MODEL_CONFIG_FILE);
    auto controller=std::make_unique<GS::TRMControlModel::Controller>(config,*model);
    const auto& cfg=controller->trmControlModelConfiguration();
    GS::En::PhoneticStringParser parser(config,*controller);
    std::string phones;
    if (phonetic) phones=text;
    else {
      GS::En::TextParser frontend(config,cfg.dictionary1File,cfg.dictionary2File,cfg.dictionary3File);
      phones=frontend.parseText(text);
    }
    {std::ofstream f("/output.phones"); f<<phones;}
    controller->synthesizePhoneticString(parser,phones.c_str(),"/output.trm","/output.wav");
    std::ofstream events("/output.events");
    const auto& list=controller->eventList();
    for (unsigned int i=0;i<10000;++i) {
      auto* p=list.getPostureDataAtIndex(i);
      if (!p || !p->posture) break;
      events<<p->posture->name()<<"\t"<<p->onset<<"\n";
    }
    return 0;
  } catch (const std::exception& e) {lastError=e.what(); return 2;}
  catch (...) {lastError="Unknown GnuspeechSA failure"; return 3;}
}
}
